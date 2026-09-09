import { createServer } from 'node:net';

import {
  CallToolResultSchema,
  ErrorCode,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  mutationResultSchema,
  statusResultSchema,
  toolFailureSchema,
  type StatusResult,
} from '../../src/contracts/display.js';
import { CanvasMcpProcess } from '../helpers/canvas-process.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuredContent(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result['structuredContent'])) {
    throw new Error('Expected structured tool content.');
  }
  return result['structuredContent'];
}

async function getStatus(process: CanvasMcpProcess): Promise<StatusResult> {
  const result = await process.client.callTool({
    name: 'canvas_get_status',
    arguments: {},
  });
  return statusResultSchema.parse(structuredContent(result));
}

async function waitForStreamCount(
  process: CanvasMcpProcess,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await getStatus(process)).connectedBrowsers === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the browser stream count.');
}

async function openBrowserSession(status: StatusResult) {
  const accessUrl = new URL(status.browserUrl);
  const token = new URLSearchParams(accessUrl.hash.slice(1)).get('token');
  expect(token).not.toBeNull();
  const response = await fetch(`${accessUrl.origin}/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: accessUrl.origin,
    },
    body: JSON.stringify({ token }),
  });
  expect(response.status).toBe(204);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  expect(cookie).toBeDefined();
  return {
    address: accessUrl.origin,
    cookie: cookie ?? '',
    token: token ?? '',
  };
}

async function selectLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to select a loopback test port.');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  return address.port;
}

describe('compiled MCP process', () => {
  const processes: CanvasMcpProcess[] = [];

  afterEach(async () => {
    await Promise.all(processes.splice(0).map((process) => process.close()));
  });

  it('discovers exact tools and preserves domain versus protocol failures', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);

    const discovery = await process.client.listTools();
    expect(discovery.tools.map((tool) => tool.name)).toEqual([
      'canvas_get_status',
      'canvas_present',
      'canvas_clear',
    ]);
    expect(
      discovery.tools.every(
        (tool) => tool.inputSchema['additionalProperties'] === false,
      ),
    ).toBe(true);

    const initial = await getStatus(process);
    expect(initial.browserUrl).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{43}$/,
    );
    expect(initial.revision).toBe(0);
    expect(initial.hasView).toBe(false);
    expect(initial.connectedBrowsers).toBe(0);

    const present = await process.client.callTool({
      name: 'canvas_present',
      arguments: {
        title: 'Synthetic message',
        html: '<article><p>Safe synthetic body</p></article>',
        css: 'p { color: navy; }',
      },
    });
    expect(present.isError).toBeUndefined();
    const presentResult = mutationResultSchema.parse(
      structuredContent(present),
    );
    expect(present.content).toEqual([
      { type: 'text', text: JSON.stringify(presentResult) },
    ]);
    expect(presentResult.revision).toBe(1);

    const invalidMarker = 'invalid-known-marker';
    const invalid = await process.client.callTool({
      name: 'canvas_present',
      arguments: {
        title: invalidMarker,
        html: 42,
      },
    });
    expect(invalid.isError).toBe(true);
    const invalidFailure = toolFailureSchema.parse(structuredContent(invalid));
    expect(invalidFailure).toEqual({
      code: 'INVALID_INPUT',
      message: 'The tool input is invalid.',
    });
    expect(JSON.stringify(invalid)).not.toContain(invalidMarker);
    expect((await getStatus(process)).revision).toBe(1);

    const unknownMarker = 'unknown-tool-marker';
    const unknownError = await process.client
      .callTool({ name: unknownMarker, arguments: {} })
      .catch((error: unknown) => error);
    expect(unknownError).toMatchObject({ code: ErrorCode.InvalidParams });
    expect(String(unknownError)).not.toContain(unknownMarker);

    const malformedMarker = 'malformed-protocol-marker';
    const malformedRequest = {
      method: 'tools/call',
      params: {
        name: 'canvas_present',
        arguments: malformedMarker,
      },
    } as unknown as CallToolRequest;
    const malformedError = await process.client
      .request(malformedRequest, CallToolResultSchema)
      .catch((error: unknown) => error);
    expect(malformedError).toMatchObject({ code: ErrorCode.InvalidParams });
    expect(String(malformedError)).not.toContain(malformedMarker);
    expect((await getStatus(process)).revision).toBe(1);

    expect(process.stderr).not.toContain(invalidMarker);
    expect(process.stderr).not.toContain(unknownMarker);
    expect(process.stderr).not.toContain(malformedMarker);
    expect(process.protocolErrors).toEqual([]);
  });

  it('reports streams, serial mutations, clear, and restart invalidation', async () => {
    const port = await selectLoopbackPort();
    const first = await CanvasMcpProcess.start(port);
    processes.push(first);
    const initial = await getStatus(first);
    expect(new URL(initial.browserUrl).port).toBe(port.toString());
    const session = await openBrowserSession(initial);
    const stream = await fetch(`${session.address}/events`, {
      headers: { cookie: session.cookie },
    });
    expect(stream.status).toBe(200);
    expect((await getStatus(first)).connectedBrowsers).toBe(1);

    const [firstMutation, secondMutation] = await Promise.all([
      first.client.callTool({
        name: 'canvas_present',
        arguments: { title: 'First', html: '<p>First synthetic view</p>' },
      }),
      first.client.callTool({
        name: 'canvas_present',
        arguments: { title: 'Second', html: '<p>Second synthetic view</p>' },
      }),
    ]);
    expect(
      mutationResultSchema.parse(structuredContent(firstMutation)).revision,
    ).toBe(1);
    expect(
      mutationResultSchema.parse(structuredContent(secondMutation)).revision,
    ).toBe(2);

    const clear = await first.client.callTool({
      name: 'canvas_clear',
      arguments: {},
    });
    expect(mutationResultSchema.parse(structuredContent(clear))).toMatchObject({
      revision: 3,
      warnings: [],
    });
    expect(await getStatus(first)).toMatchObject({
      instanceId: initial.instanceId,
      revision: 3,
      hasView: false,
      connectedBrowsers: 1,
    });
    await stream.body?.cancel();
    await waitForStreamCount(first, 0);

    await first.close();
    processes.splice(processes.indexOf(first), 1);
    const second = await CanvasMcpProcess.start(port);
    processes.push(second);
    const restarted = await getStatus(second);
    expect(new URL(restarted.browserUrl).port).toBe(port.toString());
    expect(restarted.instanceId).not.toBe(initial.instanceId);
    expect(restarted.revision).toBe(0);
    expect(restarted.hasView).toBe(false);

    const newAddress = new URL(restarted.browserUrl).origin;
    const oldTokenResponse = await fetch(`${newAddress}/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: newAddress,
      },
      body: JSON.stringify({ token: session.token }),
    });
    expect(oldTokenResponse.status).toBe(401);
    const oldCookieResponse = await fetch(`${newAddress}/events`, {
      headers: { cookie: session.cookie },
    });
    expect(oldCookieResponse.status).toBe(401);
  }, 15_000);
});
