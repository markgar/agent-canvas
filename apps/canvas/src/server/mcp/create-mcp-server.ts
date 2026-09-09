import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  canvasGetStatusInputSchema,
  type StatusResult,
  type ToolFailure,
} from '../../contracts/display.js';
import type {
  DisplayService,
  MutationOutcome,
} from '../display/display-service.js';

const unavailableFailure = {
  code: 'UNAVAILABLE',
  message: 'The display service is unavailable.',
} as const satisfies ToolFailure;

const invalidInputFailure = {
  code: 'INVALID_INPUT',
  message: 'The tool input is invalid.',
} as const satisfies ToolFailure;

const tools = [
  {
    name: 'canvas_get_status',
    description: 'Get the current Agent Canvas status and browser access URL.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'canvas_present',
    description: 'Replace the current Agent Canvas view.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
        },
        html: { type: 'string' },
        css: { type: 'string' },
      },
      required: ['title', 'html'],
      additionalProperties: false,
    },
  },
  {
    name: 'canvas_clear',
    description: 'Clear the current Agent Canvas view.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

const safeCallToolRequestSchema = z.looseObject({
  method: z.literal('tools/call'),
  params: z.unknown(),
});

export interface CreateMcpServerOptions {
  displayService: DisplayService;
  getStatus: () => StatusResult;
  onProtocolError?: () => void;
  onProtocolClose?: () => void;
}

export interface CanvasMcpServer {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

function toolResult(
  result: object,
  isError = false,
): {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
  isError?: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: Object.fromEntries(Object.entries(result)),
    ...(isError ? { isError: true as const } : {}),
  };
}

function mutationResult(outcome: MutationOutcome) {
  return outcome.ok
    ? toolResult(outcome.result)
    : toolResult(outcome.failure, true);
}

export function createMcpServer(
  options: CreateMcpServerOptions,
): CanvasMcpServer {
  // The low-level server is required to separate protocol errors from domain failures.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const server = new Server(
    {
      name: 'agent-canvas',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );
  let closing = false;

  server.onerror = () => {
    options.onProtocolError?.();
  };
  server.onclose = () => {
    if (!closing) {
      options.onProtocolClose?.();
    }
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools],
  }));

  server.setRequestHandler(safeCallToolRequestSchema, async (request) => {
    // Server validates against CallToolRequestSchema before invoking this handler.
    const call = request as CallToolRequest;
    const input = call.params.arguments ?? {};

    switch (call.params.name) {
      case 'canvas_get_status': {
        if (!canvasGetStatusInputSchema.safeParse(input).success) {
          return toolResult(invalidInputFailure, true);
        }
        try {
          return toolResult(options.getStatus());
        } catch {
          return toolResult(unavailableFailure, true);
        }
      }
      case 'canvas_present':
        try {
          return mutationResult(await options.displayService.present(input));
        } catch {
          return toolResult(unavailableFailure, true);
        }
      case 'canvas_clear':
        try {
          return mutationResult(await options.displayService.clear(input));
        } catch {
          return toolResult(unavailableFailure, true);
        }
      default:
        throw new McpError(ErrorCode.InvalidParams, 'Unknown tool.');
    }
  });

  return {
    connect(transport) {
      return server.connect(transport);
    },
    close() {
      closing = true;
      return server.close();
    },
  };
}
