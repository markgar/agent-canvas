import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

import { describe, expect, it } from 'vitest';

describe('process entry point', () => {
  it('reports its address on stderr, keeps stdout clean, and stops on SIGTERM', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/server/main.ts'],
      {
        env: { ...process.env, AGENT_CANVAS_PORT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8_000,
        killSignal: 'SIGKILL',
      },
    );
    const closed = once(child, 'close');
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    const lines = createInterface({ input: child.stderr });

    try {
      let address: string | undefined;
      for await (const line of lines) {
        const match =
          /^Agent Canvas listening at (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
        if (match?.[1]) {
          address = match[1];
          break;
        }
      }
      if (address === undefined) {
        throw new Error(
          'Server exited without reporting its listening address.',
        );
      }
      const response = await fetch(`${address}/health`);
      expect(response.status).toBe(200);
      child.kill('SIGTERM');
      expect(await closed).toEqual([0, null]);
      expect(stdout).toBe('');
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await closed;
    }
  }, 10_000);

  it('exits nonzero on invalid configuration without echoing the value', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/server/main.ts'],
      {
        env: { ...process.env, AGENT_CANVAS_PORT: 'sensitive-invalid-value' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8_000,
        killSignal: 'SIGKILL',
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    expect(await once(child, 'close')).toEqual([1, null]);
    expect(stderr).toContain('AGENT_CANVAS_PORT must be an integer');
    expect(stderr).not.toContain('sensitive-invalid-value');
  }, 10_000);
});
