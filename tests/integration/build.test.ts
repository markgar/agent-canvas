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

const source = fileURLToPath(new URL('../..', import.meta.url));

describe('shared build tooling without a feature harness', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'canvas-build-'));
    for (const directory of [
      'scripts',
      'src/server',
      'src/contracts',
      'src/client/shell',
    ])
      mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of [
      'package.json',
      'package-lock.json',
      'eslint.config.mjs',
      'tsconfig.base.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'tsconfig.server.json',
      'tsconfig.client.json',
      'tsconfig.contracts.json',
    ])
      copyFileSync(path.join(source, file), path.join(root, file));
    cpSync(path.join(source, 'scripts'), path.join(root, 'scripts'), {
      recursive: true,
    });
    symlinkSync(
      path.join(source, 'node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    writeFileSync(
      path.join(root, 'src/server/main.ts'),
      'export const value = 1;',
    );
    writeFileSync(
      path.join(root, 'src/contracts/value.ts'),
      'export type Value = number;',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const compile = () =>
    spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    });

  it('builds the scaffold without creating a fake browser entry', () => {
    const result = compile();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(root, 'dist/server/main.js'))).toBe(true);
    expect(existsSync(path.join(root, 'dist/client/main.js'))).toBe(false);
  }, 35_000);

  it('builds real JS and imported CSS when an entry is supplied', () => {
    writeFileSync(
      path.join(root, 'src/client/shell/main.ts'),
      'import "./main.css"; document.title = "Synthetic build fixture";',
    );
    writeFileSync(
      path.join(root, 'src/client/shell/main.css'),
      'body { color: blue; }',
    );
    const result = compile();
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(path.join(root, 'dist/client/main.js'), 'utf8'),
    ).toContain('Synthetic build fixture');
    expect(
      readFileSync(path.join(root, 'dist/client/main.css'), 'utf8'),
    ).toMatch(/color:\s*(?:blue|#00f)/);
  }, 35_000);

  it('rejects Node globals in production browser code', () => {
    writeFileSync(
      path.join(root, 'src/client/shell/main.ts'),
      'process.exit(0);',
    );
    expect(compile().status).not.toBe(0);
  }, 35_000);
});
