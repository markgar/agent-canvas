import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';

import { statusResultSchema } from '../contracts/display.js';
import { readConfig } from './config.js';
import { createServer } from './http/create-server.js';
import { createRuntime, type CanvasRuntime } from './runtime.js';

describe('createRuntime', () => {
  let runtime: CanvasRuntime | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await runtime?.close();
  });

  it('shares one display and session state across MCP and HTTP', async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    runtime = createRuntime(readConfig({}), { transport: serverTransport });
    const address = await runtime.start();
    client = new Client({ name: 'runtime-test', version: '1.0.0' });
    await client.connect(clientTransport);

    const initial = statusResultSchema.parse(
      (
        await client.callTool({
          name: 'canvas_get_status',
          arguments: {},
        })
      ).structuredContent,
    );
    expect(initial.browserUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{43}$/,
    );
    expect(initial.revision).toBe(0);
    expect(initial.hasView).toBe(false);
    expect(initial.connectedBrowsers).toBe(0);

    const url = new URL(initial.browserUrl);
    const token = new URLSearchParams(url.hash.slice(1)).get('token');
    expect(token).not.toBeNull();
    const sessionResponse = await fetch(`${address}/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: address,
      },
      body: JSON.stringify({ token }),
    });
    expect(sessionResponse.status).toBe(204);
    const cookie = sessionResponse.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeDefined();

    const streamResponse = await fetch(`${address}/events`, {
      headers: { cookie: cookie ?? '' },
    });
    expect(streamResponse.status).toBe(200);

    const connected = statusResultSchema.parse(
      (
        await client.callTool({
          name: 'canvas_get_status',
          arguments: {},
        })
      ).structuredContent,
    );
    expect(connected.connectedBrowsers).toBe(1);

    const mutation = await client.callTool({
      name: 'canvas_present',
      arguments: {
        title: 'Synthetic update',
        html: '<p>Runtime integration</p>',
      },
    });
    expect(mutation.isError).toBeUndefined();

    const updated = statusResultSchema.parse(
      (
        await client.callTool({
          name: 'canvas_get_status',
          arguments: {},
        })
      ).structuredContent,
    );
    expect(updated.instanceId).toBe(initial.instanceId);
    expect(updated.revision).toBe(1);
    expect(updated.hasView).toBe(true);

    await streamResponse.body?.cancel();
  });

  it('closes the HTTP listener when MCP startup fails', async () => {
    let observedServer: ReturnType<typeof createServer> | undefined;
    const failingTransport = {
      start: () => Promise.reject(new Error('transport startup failed')),
      send: async () => {},
      close: async () => {},
    };
    runtime = createRuntime(readConfig({}), {
      transport: failingTransport,
      createHttpServer(config, options) {
        observedServer = createServer(config, options);
        return observedServer;
      },
    });

    await expect(runtime.start()).rejects.toThrow('transport startup failed');
    expect(observedServer?.server.listening).toBe(false);
  });
});
