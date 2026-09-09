import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const appSource = fileURLToPath(new URL('../..', import.meta.url));
const repositorySource = fileURLToPath(new URL('../../../..', import.meta.url));

describe('shared build tooling without a feature harness', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'canvas-build-'));
    const appRoot = path.join(root, 'apps/canvas');
    for (const directory of [
      'apps/canvas/scripts',
      'apps/canvas/src/server',
      'apps/canvas/src/contracts',
      'apps/canvas/src/client/shell',
    ])
      mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'tsconfig.server.json',
      'tsconfig.client.json',
      'tsconfig.contracts.json',
    ])
      copyFileSync(path.join(appSource, file), path.join(appRoot, file));
    copyFileSync(
      path.join(repositorySource, 'tsconfig.base.json'),
      path.join(root, 'tsconfig.base.json'),
    );
    cpSync(path.join(appSource, 'scripts'), path.join(appRoot, 'scripts'), {
      recursive: true,
    });
    symlinkSync(
      path.join(repositorySource, 'node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    writeFileSync(
      path.join(appRoot, 'src/server/main.ts'),
      'export const value = 1;',
    );
    writeFileSync(
      path.join(appRoot, 'src/contracts/value.ts'),
      'export type Value = number;',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const compile = () =>
    spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: path.join(root, 'apps/canvas'),
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('builds the scaffold without creating a fake browser entry', () => {
    const result = compile();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(root, 'apps/canvas/dist/server/main.js'))).toBe(
      true,
    );
    expect(existsSync(path.join(root, 'apps/canvas/dist/client/main.js'))).toBe(
      false,
    );
  }, 35_000);

  it('builds real JS and imported CSS when an entry is supplied', () => {
    writeFileSync(
      path.join(root, 'apps/canvas/src/client/shell/main.ts'),
      'import "./main.css"; document.title = "Synthetic build fixture";',
    );
    writeFileSync(
      path.join(root, 'apps/canvas/src/client/shell/main.css'),
      'body { color: blue; }',
    );
    const result = compile();
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(path.join(root, 'apps/canvas/dist/client/main.js'), 'utf8'),
    ).toContain('Synthetic build fixture');
    expect(
      readFileSync(path.join(root, 'apps/canvas/dist/client/main.css'), 'utf8'),
    ).toMatch(/color:\s*(?:blue|#00f)/);
  }, 35_000);

  it('rejects Node globals in production browser code', () => {
    writeFileSync(
      path.join(root, 'apps/canvas/src/client/shell/main.ts'),
      'process.exit(0);',
    );
    expect(compile().status).not.toBe(0);
  }, 35_000);
});
