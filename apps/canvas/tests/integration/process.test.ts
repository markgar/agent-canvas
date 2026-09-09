import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { CanvasChildProcess } from '../helpers/canvas-process.js';

describe('compiled process entry point', () => {
  const processes: CanvasChildProcess[] = [];

  afterEach(async () => {
    await Promise.all(processes.splice(0).map((process) => process.close()));
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'serves health with clean stdout and stops on %s',
    async (signal) => {
      const process = CanvasChildProcess.spawn();
      processes.push(process);
      const address = await process.waitForAddress();

      const response = await fetch(`${address}/health`);
      expect(response.status).toBe(200);
      process.signal(signal);
      expect(await process.waitForExit(5_000)).toEqual([0, null]);
      expect(process.stdout).toBe('');
    },
    120_000,
  );

  it('stops cleanly when MCP stdin reaches EOF', async () => {
    const process = CanvasChildProcess.spawn();
    processes.push(process);
    await process.waitForAddress();

    process.endInput();

    expect(await process.waitForExit()).toEqual([0, null]);
    expect(process.stdout).toBe('');
  });

  it('shuts down HTTP and exits nonzero after a fatal MCP transport failure', async () => {
    const process = CanvasChildProcess.spawn();
    processes.push(process);
    const address = await process.waitForAddress();

    const chunk = 'x'.repeat(64 * 1024);
    for (let index = 0; index < 161; index += 1) {
      process.writeInput(chunk);
    }

    expect(await process.waitForExit()).toEqual([1, null]);
    await expect(fetch(`${address}/health`)).rejects.toThrow();
    expect(process.stderr).toContain(
      'Agent Canvas MCP transport closed unexpectedly.',
    );
    expect(process.stdout).toBe('');
  });

  it('fails safely when the requested port is occupied', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '127.0.0.1', resolve);
    });
    const address = occupied.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Unable to reserve a test port.');
    }
    const process = CanvasChildProcess.spawn(address.port);
    processes.push(process);

    try {
      expect(await process.waitForExit()).toEqual([1, null]);
      expect(process.stdout).toBe('');
      expect(process.stderr).toContain('EADDRINUSE');
      expect(process.stderr).not.toContain('#token=');
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });

  it('exits nonzero on invalid configuration without echoing the value', async () => {
    const process = CanvasChildProcess.spawn('sensitive-invalid-value');
    processes.push(process);

    expect(await process.waitForExit()).toEqual([1, null]);
    expect(process.stderr).toContain('AGENT_CANVAS_PORT must be an integer');
    expect(process.stderr).not.toContain('sensitive-invalid-value');
    expect(process.stdout).toBe('');
  });
});
