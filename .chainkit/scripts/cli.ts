import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { parseSpec, requireApproval } from './contracts.js';
import {
  fingerprint,
  git,
  requireClean,
  requireFreshBase,
} from './repository.js';
import { writeState } from './state.js';
import { verifyVendor } from './vendor.js';

function invokeEngine(root: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'vendor/chainkit/run.mjs'),
      '--chain',
      path.join(root, '.chainkit/chains/build-feature.yaml'),
      ...args,
    ],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Chainkit exited with ${String(result.status ?? result.signal)}.`,
    );
  }
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      spec: { type: 'string' },
      workdir: { type: 'string' },
      execute: { type: 'boolean', default: false },
    },
  });
  const operation = positionals[0];
  if (
    positionals.length !== 1 ||
    !['validate', 'run'].includes(operation ?? '')
  ) {
    throw new Error(
      'Usage: chainkit:validate [--spec path] OR chainkit:run --spec path --workdir path --execute',
    );
  }
  const root = realpathSync(path.resolve(values.workdir ?? process.cwd()));
  verifyVendor(root);
  if (operation === 'validate') {
    const paths = values.spec
      ? [path.resolve(root, values.spec)]
      : readdirSync(path.join(root, 'specs'))
          .filter((file) => file.endsWith('.md') && file !== 'TEMPLATE.md')
          .map((file) => path.join(root, 'specs', file));
    for (const file of paths) parseSpec(readFileSync(file, 'utf8'));
    invokeEngine(root, [
      '--validate-only',
      ...(values.spec
        ? ['--seed', `spec=@${path.resolve(root, values.spec)}`]
        : []),
    ]);
    return;
  }
  if (!values.spec || !values.workdir || !values.execute) {
    throw new Error(
      'Run requires --spec, --workdir, and --execute (model spend and local commits).',
    );
  }
  if (git(root, 'rev-parse', '--show-toplevel') !== root) {
    throw new Error('--workdir must name the repository root.');
  }
  const specPath = path.relative(
    root,
    realpathSync(path.resolve(root, values.spec)),
  );
  if (!/^specs\/[a-z0-9-]+\.md$/.test(specPath)) {
    throw new Error('--spec must be a named feature document inside specs/.');
  }
  const specText = readFileSync(path.join(root, specPath), 'utf8');
  const spec = parseSpec(specText);
  requireApproval(spec);
  requireClean(root);
  requireFreshBase(root, spec.metadata.base_commit, specPath);
  const scripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(
      JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
    ).scripts;
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-canvas-chain-'));
  process.env['AGENT_CANVAS_CHAIN_STATE'] = directory;
  try {
    writeState('run.json', {
      cwd: root,
      base: git(root, 'rev-parse', 'HEAD'),
      specPath,
      specText,
      initialFingerprint: fingerprint(root),
      scripts,
    });
    invokeEngine(root, [
      '--seed',
      `spec=@${path.join(root, specPath)}`,
      '--workdir',
      root,
      '--results',
      path.join(root, '.chainkit/results'),
    ]);
  } finally {
    delete process.env['AGENT_CANVAS_CHAIN_STATE'];
    rmSync(directory, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
