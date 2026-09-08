import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { StatusResult } from '../contracts/display.js';
import type { ServerConfig } from './config.js';
import {
  createDisplayService,
  type DisplayService,
} from './display/display-service.js';
import { createServer } from './http/create-server.js';
import {
  createMcpServer,
  type CanvasMcpServer,
  type CreateMcpServerOptions,
} from './mcp/create-mcp-server.js';
import { BrowserSessions } from './security/browser-sessions.js';
import { sanitizeDisplayContent } from './security/sanitize-display.js';

interface RuntimeOptions {
  transport?: Transport;
  sessions?: BrowserSessions;
  displayService?: DisplayService;
  createHttpServer?: typeof createServer;
  createProtocolServer?: (options: CreateMcpServerOptions) => CanvasMcpServer;
  onProtocolError?: () => void;
}

export interface CanvasRuntime {
  start(): Promise<string>;
  close(): Promise<void>;
  readonly address: string | undefined;
}

export function createRuntime(
  config: ServerConfig,
  options: RuntimeOptions = {},
): CanvasRuntime {
  const sessions = options.sessions ?? new BrowserSessions();
  const displayService =
    options.displayService ??
    createDisplayService({ sanitizer: sanitizeDisplayContent });
  const httpServer = (options.createHttpServer ?? createServer)(config, {
    sessions,
    displayService,
  });
  const transport = options.transport ?? new StdioServerTransport();
  let address: string | undefined;
  let available = false;
  let startPromise: Promise<string> | undefined;
  let closePromise: Promise<void> | undefined;

  const getStatus = (): StatusResult => {
    if (!available || address === undefined) {
      throw new Error('Runtime unavailable.');
    }
    const snapshot = displayService.getSnapshot();
    return {
      browserUrl: sessions.accessUrl(Number(new URL(address).port)),
      instanceId: snapshot.instanceId,
      revision: snapshot.revision,
      hasView: snapshot.view !== null,
      connectedBrowsers: sessions.activeStreamCount,
    };
  };

  const protocolServer = (options.createProtocolServer ?? createMcpServer)({
    displayService,
    getStatus,
    ...(options.onProtocolError === undefined
      ? {}
      : { onProtocolError: options.onProtocolError }),
  });

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      available = false;
      const results = await Promise.allSettled([
        protocolServer.close(),
        httpServer.close(),
      ]);
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error('Agent Canvas shutdown did not complete cleanly.');
      }
    })();
    return closePromise;
  };

  return {
    start() {
      if (startPromise !== undefined) {
        return startPromise;
      }
      startPromise = (async () => {
        try {
          address = await httpServer.listen(config);
          available = true;
          await protocolServer.connect(transport);
          return address;
        } catch (error) {
          available = false;
          try {
            await close();
          } catch {
            throw new Error(
              'Agent Canvas startup failed and cleanup was incomplete.',
            );
          }
          throw error;
        }
      })();
      return startPromise;
    },
    close,
    get address() {
      return address;
    },
  };
}
