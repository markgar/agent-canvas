import { afterEach, describe, expect, it } from 'vitest';

import { healthResponseSchema } from '../../src/contracts/health.js';
import { readConfig } from '../../src/server/config.js';
import { createServer } from '../../src/server/http/create-server.js';

describe('HTTP listener', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('listens on an ephemeral loopback port and serves its contract', async () => {
    const config = readConfig({});
    const server = createServer(config);
    servers.push(server);
    const address = await server.listen(config);

    expect(new URL(address).hostname).toBe('127.0.0.1');
    expect(new URL(address).port).not.toBe('0');

    const response = await fetch(`${address}/health`);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json()).status).toBe('ok');
  });

  it('fails rather than silently moving off an explicitly occupied port', async () => {
    const config = readConfig({});
    const first = createServer(config);
    servers.push(first);
    const address = await first.listen(config);
    const second = createServer(config);
    servers.push(second);

    await expect(
      second.listen({ host: config.host, port: Number(new URL(address).port) }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
