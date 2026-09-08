import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

import { git } from './repository.js';
import { examplePlan, exampleSpec } from './test-fixtures.js';
import { verifyVendor } from './vendor.js';

const source = fileURLToPath(new URL('../..', import.meta.url));
const directories: string[] = [];
const finding = {
  id: 'missing-behavior',
  file: 'src/value.ts',
  requirement: 'EX-001',
  problem: 'The required behavior is absent.',
  remedy: 'Implement the required behavior.',
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(mode: 'pass' | 'plan-findings' | 'code-findings') {
  const root = mkdtempSync(path.join(tmpdir(), 'canvas-engine-test-'));
  directories.push(root);
  const work = path.join(root, 'work');
  const replay = path.join(root, 'replay');
  mkdirSync(work);
  mkdirSync(replay);
  cpSync(path.join(source, '.chainkit'), path.join(work, '.chainkit'), {
    recursive: true,
    filter: (file) => !['results', 'runtime'].includes(path.basename(file)),
  });
  cpSync(path.join(source, 'vendor'), path.join(work, 'vendor'), {
    recursive: true,
  });
  symlinkSync(
    path.join(source, 'node_modules'),
    path.join(work, 'node_modules'),
    'dir',
  );
  mkdirSync(path.join(work, 'specs'));
  mkdirSync(path.join(work, 'src'));
  writeFileSync(
    path.join(work, '.gitignore'),
    'node_modules\n.chainkit/results\n',
  );
  writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: {
        build: 'node -e "process.exit(0)"',
        typecheck: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(0)"',
        'format:check': 'node -e "process.exit(0)"',
        check: 'node -e "process.exit(0)"',
      },
    }),
  );

  // Only the model-driven edit is substituted; production scheduling and gates run unchanged.
  const chainFile = path.join(work, '.chainkit/chains/build-feature.yaml');
  const chain = z
    .looseObject({
      stages: z.array(z.record(z.string(), z.unknown())),
    })
    .parse(parse(readFileSync(chainFile, 'utf8')));
  for (const stage of chain.stages) {
    if (stage['id'] !== 'code' && stage['id'] !== 'fix') continue;
    delete stage['prompt'];
    delete stage['tools'];
    delete stage['resume'];
    delete stage['resumeFrom'];
    stage['run'] =
      "node -e \"require('node:fs').writeFileSync('src/value.ts','export const value = 1;\\\\n')\"";
  }
  writeFileSync(chainFile, stringify(chain));
  git(work, 'init', '-q');
  git(work, 'config', 'user.name', 'Fixture');
  git(work, 'config', 'user.email', 'fixture@example.invalid');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'fixture baseline');
  writeFileSync(
    path.join(work, 'specs/example.md'),
    exampleSpec(git(work, 'rev-parse', 'HEAD')),
  );
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'approved spec');
  const base = git(work, 'rev-parse', 'HEAD');
  const streams: Record<string, unknown> = {
    plan: examplePlan(),
    'plan-review': {
      pass: mode !== 'plan-findings',
      findings: mode === 'plan-findings' ? [finding] : [],
    },
    'plan-fix': examplePlan(),
    'review.i1': {
      pass: mode !== 'code-findings',
      findings: mode === 'code-findings' ? [finding] : [],
    },
  };
  for (const [label, content] of Object.entries(streams)) {
    const sessionId = label === 'plan' ? 'plan-session' : `session-${label}`;
    writeFileSync(
      path.join(replay, `${label}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant.message',
          data: { model: 'gpt-5.6-sol', content: JSON.stringify(content) },
        }),
        JSON.stringify({ type: 'result', sessionId }),
        '',
      ].join('\n'),
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '.chainkit/scripts/cli.ts',
      'run',
      '--spec',
      'specs/example.md',
      '--workdir',
      work,
      '--execute',
    ],
    {
      cwd: work,
      env: { ...process.env, FLASH_CHAIN_REPLAY: replay },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  const records = path.join(work, '.chainkit/results/chain-runs');
  const recordFile = existsSync(records)
    ? readdirSync(records).find((file) => file.endsWith('.json'))
    : undefined;
  const record = recordFile
    ? readFileSync(path.join(records, recordFile), 'utf8')
    : '';
  return { work, base, result, record };
}

describe('actual executor wiring with offline model replay', () => {
  it('delivers after one review, one repair handoff, and objective gates', () => {
    const { work, base, result, record } = fixture('pass');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(path.join(work, 'src/value.ts'), 'utf8')).toContain(
      'value = 1',
    );
    expect(git(work, 'rev-list', '--count', `${base}..HEAD`)).toBe('1');
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(result.stdout.match(/→ fix/g)?.length).toBe(1);
    expect(record).toContain('"delivered": true');
  }, 70_000);

  it('applies plan findings once and proceeds with the corrected plan', () => {
    const { work, base, result } = fixture('plan-findings');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('plan-review');
    expect(result.stdout).toContain('plan-fix');
    expect(result.stdout).toContain('→ code');
    expect(git(work, 'rev-list', '--count', `${base}..HEAD`)).toBe('1');
  }, 70_000);

  it('passes implementation findings directly to one repair before gating', () => {
    const { work, base, result } = fixture('code-findings');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.match(/→ fix/g)?.length).toBe(1);
    expect(git(work, 'rev-list', '--count', `${base}..HEAD`)).toBe('1');
  }, 70_000);

  it('rejects modified and added vendor files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'canvas-vendor-test-'));
    directories.push(root);
    cpSync(path.join(source, 'vendor'), path.join(root, 'vendor'), {
      recursive: true,
    });
    mkdirSync(path.join(root, '.chainkit'));
    cpSync(
      path.join(source, '.chainkit/vendor.json'),
      path.join(root, '.chainkit/vendor.json'),
    );
    expect(() => {
      verifyVendor(root);
    }).not.toThrow();
    const license = path.join(root, 'vendor/chainkit/LICENSE');
    const original = readFileSync(license);
    writeFileSync(license, 'changed');
    expect(() => {
      verifyVendor(root);
    }).toThrow('differs');
    writeFileSync(license, original);
    writeFileSync(path.join(root, 'vendor/chainkit/unexpected.txt'), 'extra');
    expect(() => {
      verifyVendor(root);
    }).toThrow('differs');
  });
});
