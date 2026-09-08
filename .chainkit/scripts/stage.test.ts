import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runReadOnlyCheck } from './checks.js';
import {
  fingerprint,
  git,
  requireClean,
  requireFreshBase,
} from './repository.js';
import { executeStage } from './stage.js';
import { runStateSchema } from './state.js';
import { examplePlan, exampleSpec } from './test-fixtures.js';

describe('consumer-owned chain gates', { timeout: 20_000 }, () => {
  let root: string;
  let work: string;
  let state: string;
  let artifacts: string;
  let specText: string;
  let base: string;
  const plan = examplePlan();

  const writeJson = (file: string, value: unknown) => {
    writeFileSync(file, JSON.stringify(value));
  };
  const supply = (value: unknown) => {
    writeJson(artifacts, value);
  };
  const approvePlan = () => {
    supply({ buildPlan: plan });
    executeStage('lock-plan');
  };
  const prepare = () => {
    approvePlan();
    supply({ chunk: plan.chunks[0] });
    executeStage('prepare');
  };
  const makeChange = () => {
    writeFileSync(path.join(work, 'src/value.ts'), 'export const value = 1;\n');
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'canvas-chain-test-'));
    work = path.join(root, 'work');
    state = path.join(root, 'state');
    mkdirSync(path.join(work, 'src'), { recursive: true });
    mkdirSync(path.join(work, 'specs'));
    mkdirSync(state);
    artifacts = path.join(root, 'artifacts.json');
    const scripts = {
      build: 'node -e "process.exit(0)"',
      typecheck: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
      'format:check': 'node -e "process.exit(0)"',
      check: 'node -e "process.exit(0)"',
    };
    writeJson(path.join(work, 'package.json'), { scripts });
    git(work, 'init', '-q');
    git(work, 'config', 'user.name', 'Fixture');
    git(work, 'config', 'user.email', 'fixture@example.invalid');
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'fixture base');
    base = git(work, 'rev-parse', 'HEAD');
    specText = exampleSpec(base);
    writeFileSync(path.join(work, 'specs/example.md'), specText);
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'approved fixture spec');
    writeJson(path.join(state, 'run.json'), {
      cwd: work,
      base: git(work, 'rev-parse', 'HEAD'),
      specPath: 'specs/example.md',
      specText,
      initialFingerprint: fingerprint(work),
      scripts,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(work);
    vi.stubEnv('AGENT_CANVAS_CHAIN_STATE', state);
    vi.stubEnv('CHAINKIT_ARTIFACTS', artifacts);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a spec-only approval commit, but rejects dirty or stale code', () => {
    expect(() => {
      requireFreshBase(work, base, 'specs/example.md');
    }).not.toThrow();
    makeChange();
    expect(() => {
      requireClean(work);
    }).toThrow('clean');
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'code drift');
    expect(() => {
      requireFreshBase(work, base, 'specs/example.md');
    }).toThrow('stale');
  });

  it('checks the draft and corrected plans before locking the build plan', () => {
    supply({ plan });
    expect(executeStage('check-plan')).toEqual({ valid: true });
    supply({ buildPlan: plan });
    expect(executeStage('check-build-plan')).toEqual({ valid: true });
    approvePlan();
    expect(
      JSON.parse(readFileSync(path.join(state, 'plan.json'), 'utf8')),
    ).toEqual(plan);
  });

  it('refuses planning that edits the repository', () => {
    supply({ plan });
    makeChange();
    expect(() => executeStage('check-plan')).toThrow('must not modify');
  });

  it('refuses altered chunk assignments and symlink ownership', () => {
    approvePlan();
    supply({ chunk: { ...plan.chunks[0], files: ['outside.ts'] } });
    expect(() => executeStage('prepare')).toThrow('differs');
    symlinkSync(
      path.join(work, 'package.json'),
      path.join(work, 'src/value.ts'),
    );
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'symlink');
    supply({ chunk: plan.chunks[0] });
    expect(() => executeStage('prepare')).toThrow('symlinks');
  });

  it('requires current post-repair measurements before the checkpoint gate', () => {
    prepare();
    makeChange();
    expect(() => executeStage('chunk-gate')).toThrow();
    const facts = executeStage('measure');
    supply({ facts });
    expect(executeStage('chunk-gate')).toEqual({ pass: true });
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'checkpoint');
    expect(executeStage('final-gate')).toEqual({
      automatedAcceptance: 'passed',
      humanAcceptance: 'pending',
    });
  });

  it('does not let the repair handoff override measured failures', () => {
    prepare();
    makeChange();
    writeFileSync(path.join(work, 'outside.ts'), 'unowned');
    const facts = executeStage('measure');
    supply({ facts });
    expect(() => executeStage('chunk-gate')).toThrow('outside ownership');
  });

  it('builds current code and runs regressions even when the chunk selects another check', () => {
    prepare();
    makeChange();
    expect(executeStage('measure')).toMatchObject({
      pass: true,
      checks: [
        { id: '_build', command: ['npm', 'run', 'build'] },
        { id: '_typecheck', command: ['npm', 'run', 'typecheck'] },
        { id: '_regressions', command: ['npm', 'test'] },
        { id: 'behavior' },
        { id: '_format' },
      ],
    });
  });

  it('does not run acceptance against old artifacts when the build fails', () => {
    const stateFile = path.join(state, 'run.json');
    const run = runStateSchema.parse(
      JSON.parse(readFileSync(stateFile, 'utf8')),
    );
    run.scripts['build'] = 'node -e "process.exit(1)"';
    writeJson(path.join(work, 'package.json'), { scripts: run.scripts });
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'failing build fixture');
    run.initialFingerprint = fingerprint(work);
    writeJson(stateFile, run);
    prepare();
    makeChange();
    expect(executeStage('measure')).toMatchObject({
      pass: false,
      checks: [{ id: '_build', pass: false }],
    });
    supply({ facts: executeStage('measure') });
    expect(() => executeStage('chunk-gate')).toThrow(
      'outside ownership or acceptance',
    );
  });
  it('rejects a measured no-op chunk and edits after measurement', () => {
    prepare();
    let facts = executeStage('measure');
    supply({ facts });
    expect(() => executeStage('chunk-gate')).toThrow('no changes');
    makeChange();
    facts = executeStage('measure');
    supply({ facts });
    chmodSync(path.join(work, 'src/value.ts'), 0o755);
    expect(() => executeStage('chunk-gate')).toThrow('stale measured facts');
  });

  it('rejects changed specs, scripts, and agent commits', () => {
    prepare();
    makeChange();
    writeFileSync(path.join(work, 'specs/example.md'), `${specText}\nchanged`);
    expect(() => executeStage('measure')).toThrow('Approved spec changed');
    writeFileSync(path.join(work, 'specs/example.md'), specText);
    writeJson(path.join(work, 'package.json'), { scripts: { check: 'true' } });
    expect(() => executeStage('measure')).toThrow('script was changed');
    git(work, 'restore', 'package.json');
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'unauthorized checkpoint');
    expect(() => executeStage('measure')).toThrow('Only Chainkit');
  });

  it('runs argv literally and detects mutating acceptance commands', () => {
    const result = runReadOnlyCheck(work, [
      process.execPath,
      '-e',
      'process.stdout.write(process.argv[1])',
      '$(not-a-shell-command); literal',
    ]);
    expect(result.pass).toBe(true);
    expect(result.output).toContain('$(not-a-shell-command); literal');
    expect(
      runReadOnlyCheck(work, [process.execPath, '-e', 'process.exit(1)']).pass,
    ).toBe(false);
    expect(() => runReadOnlyCheck(work, [])).toThrow('empty');
    expect(() =>
      runReadOnlyCheck(work, [
        process.execPath,
        '-e',
        "require('node:fs').writeFileSync('new.txt','changed')",
      ]),
    ).toThrow('mutated');
  });
});
