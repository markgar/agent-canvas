import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
for (const config of ['tsconfig.build.json', 'tsconfig.client.json']) {
  const result = spawnSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '--project', config],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Compilation failed for ${config}.`);
}

const entry = path.join(root, 'src/client/shell/main.ts');
const output = path.join(root, 'dist/client/main.js');
for (const file of [output, path.join(root, 'dist/client/main.css')])
  rmSync(file, { force: true });

// The scaffold has no browser entry. Feature chunks can add it without changing
// the protected build command or manufacturing an empty application now.
if (existsSync(entry)) {
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2023',
    minify: true,
    logLevel: 'warning',
  });
}
