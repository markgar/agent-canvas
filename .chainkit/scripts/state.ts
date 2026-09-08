import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

export const runStateSchema = z.strictObject({
  cwd: z.string(),
  base: z.string(),
  specPath: z.string(),
  specText: z.string(),
  initialFingerprint: z.string(),
  scripts: z.record(z.string(), z.string()),
});

export const chunkStateSchema = z.strictObject({
  id: z.string(),
  head: z.string(),
  reviewedFingerprint: z.string().nullable(),
  pass: z.boolean(),
});

export function stateDirectory(): string {
  const directory = process.env['AGENT_CANVAS_CHAIN_STATE'];
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error(
      'Use npm run chainkit:run; no approved run state was supplied.',
    );
  }
  return directory;
}

export function readState(name: string): unknown {
  return JSON.parse(readFileSync(path.join(stateDirectory(), name), 'utf8'));
}

export function writeState(name: string, value: unknown): void {
  writeFileSync(
    path.join(stateDirectory(), name),
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function readArtifacts(): Record<string, unknown> {
  const file = process.env['CHAINKIT_ARTIFACTS'];
  if (!file)
    throw new Error('This operation requires Chainkit stage artifacts.');
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(file, 'utf8')));
}
