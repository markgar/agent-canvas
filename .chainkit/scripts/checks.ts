import { spawnSync } from 'node:child_process';

import { fingerprint } from './repository.js';

export function runReadOnlyCheck(cwd: string, command: string[]) {
  const executable = command[0];
  if (!executable) throw new Error('Acceptance command cannot be empty.');
  const before = fingerprint(cwd);
  const result = spawnSync(executable, command.slice(1), {
    cwd,
    shell: false,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (fingerprint(cwd) !== before) {
    throw new Error(
      'Acceptance command mutated the repository, index, or HEAD.',
    );
  }
  if (result.error) throw result.error;
  if (result.signal)
    throw new Error(`Acceptance command terminated: ${result.signal}`);
  return {
    command,
    pass: result.status === 0,
    exitCode: result.status,
    output: `${result.stdout}\n${result.stderr}`.slice(-12_000),
  };
}
