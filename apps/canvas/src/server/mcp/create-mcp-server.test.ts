import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolResultSchema,
  ErrorCode,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  statusResultSchema,
  toolFailureSchema,
} from '../../contracts/display.js';
import { createDisplayService } from '../display/display-service.js';
import { createMcpServer } from './create-mcp-server.js';

describe('createMcpServer', () => {
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function connect() {
    const displayService = createDisplayService({
      sanitizer: ({ html, css }) => {
        if (html === 'trigger-internal-failure') {
          throw new Error('sensitive-internal-marker');
        }
        return {
          html,
          css,
          text: html,
          warnings: [],
        };
      },
    });
    const server = createMcpServer({
      displayService,
      getStatus: () => {
        const snapshot = displayService.getSnapshot();
        return {
          browserUrl: 'http://127.0.0.1:3000/#token=secret',
          instanceId: snapshot.instanceId,
          revision: snapshot.revision,
          hasView: snapshot.view !== null,
          connectedBrowsers: 0,
        };
      },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: 'agent-canvas-test',
      version: '1.0.0',
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanups.push(async () => {
      await Promise.all([client.close(), server.close()]);
    });
    return { client, displayService };
  }

  it('discovers exactly the three tools with strict object schemas', async () => {
    const { client } = await connect();

    const result = await client.listTools();

    expect(result.tools).toEqual([
      expect.objectContaining({
        name: 'canvas_get_status',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      }),
      expect.objectContaining({
        name: 'canvas_present',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            html: { type: 'string' },
            css: { type: 'string' },
          },
          required: ['title', 'html'],
          additionalProperties: false,
        },
      }),
      expect.objectContaining({
        name: 'canvas_clear',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      }),
    ]);
  });

  it('returns matching text and structured envelopes for success and failure', async () => {
    const { client, displayService } = await connect();

    const status = await client.callTool({
      name: 'canvas_get_status',
      arguments: {},
    });
    expect(status.isError).toBeUndefined();
    const statusValue = statusResultSchema.parse(status.structuredContent);
    expect(status.content).toEqual([
      { type: 'text', text: JSON.stringify(statusValue) },
    ]);

    const failure = await client.callTool({
      name: 'canvas_present',
      arguments: {
        title: 'Sensitive marker',
        html: 42,
      },
    });
    expect(failure.isError).toBe(true);
    const failureValue = toolFailureSchema.parse(failure.structuredContent);
    expect(failureValue).toEqual({
      code: 'INVALID_INPUT',
      message: 'The tool input is invalid.',
    });
    expect(failure.content).toEqual([
      { type: 'text', text: JSON.stringify(failureValue) },
    ]);
    expect(displayService.getSnapshot().revision).toBe(0);

    const internalFailure = await client.callTool({
      name: 'canvas_present',
      arguments: {
        title: 'Synthetic title',
        html: 'trigger-internal-failure',
      },
    });
    expect(toolFailureSchema.parse(internalFailure.structuredContent)).toEqual({
      code: 'UNAVAILABLE',
      message: 'The display service is unavailable.',
    });
    expect(JSON.stringify(internalFailure)).not.toContain(
      'sensitive-internal-marker',
    );
    expect(displayService.getSnapshot().revision).toBe(0);
  });

  it('uses fixed protocol errors for unknown tools and malformed calls', async () => {
    const { client, displayService } = await connect();
    const unknownMarker = 'unknown-sensitive-marker';
    const malformedMarker = 'malformed-sensitive-marker';

    const unknownError = await client
      .callTool({ name: unknownMarker, arguments: {} })
      .catch((error: unknown) => error);
    expect(unknownError).toMatchObject({ code: ErrorCode.InvalidParams });
    expect(String(unknownError)).not.toContain(unknownMarker);

    const malformedRequest = {
      method: 'tools/call',
      params: {
        name: 'canvas_present',
        arguments: malformedMarker,
      },
    } as unknown as CallToolRequest;
    const malformedError = await client
      .request(malformedRequest, CallToolResultSchema)
      .catch((error: unknown) => error);
    expect(malformedError).toMatchObject({ code: ErrorCode.InvalidParams });
    expect(String(malformedError)).not.toContain(malformedMarker);
    expect(displayService.getSnapshot().revision).toBe(0);
  });
});
