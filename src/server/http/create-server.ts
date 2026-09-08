import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

import type { HealthResponse } from '../../contracts/health.js';
import type { ServerConfig } from '../config.js';
import {
  createBrowserSessions,
  type BrowserSessions,
  type RandomBytes,
} from '../security/browser-sessions.js';
import { createShellDocument } from './shell-document.js';

type ErrorCode =
  | 'BAD_REQUEST'
  | 'BODY_TOO_LARGE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SESSION_LIMIT'
  | 'UNAUTHORIZED'
  | 'UNAVAILABLE'
  | 'UNSUPPORTED_MEDIA_TYPE';

interface ShellAssets {
  javascript: string;
  css: string;
}

interface CreateServerOptions {
  sessions?: BrowserSessions;
  shellRandomBytes?: RandomBytes;
  assets?: ShellAssets;
}

function currentPort(server: FastifyInstance, config: ServerConfig): number {
  const address = server.server.address();
  return address !== null && typeof address !== 'string'
    ? address.port
    : config.port;
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const parts = value.split(';').map((part) => part.trim());
  if (parts[0]?.toLowerCase() !== 'application/json') {
    return false;
  }
  if (parts.length === 1) {
    return true;
  }
  return (
    parts.length === 2 &&
    /^charset\s*=\s*(?:"utf-8"|utf-8)$/i.test(parts[1] ?? '')
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBuiltAsset(name: 'main.js' | 'main.css'): Promise<string> {
  try {
    return await readFile(
      new URL(`../../client/${name}`, import.meta.url),
      'utf8',
    );
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
    return readFile(
      new URL(`../../../dist/client/${name}`, import.meta.url),
      'utf8',
    );
  }
}

export function createServer(
  config: ServerConfig,
  options: CreateServerOptions = {},
) {
  const server = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
    exposeHeadRoutes: false,
  });
  const sessions = options.sessions ?? createBrowserSessions();

  server.addHook('onRequest', (request, reply, done) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');

    const port = currentPort(server, config);
    const authority = `${config.host}:${port.toString()}`;

    if (request.headers.host !== authority) {
      void reply.code(403).send({ error: 'FORBIDDEN' satisfies ErrorCode });
      return;
    }

    if (
      request.headers.origin !== undefined &&
      request.headers.origin !== `http://${authority}`
    ) {
      void reply.code(403).send({ error: 'FORBIDDEN' satisfies ErrorCode });
      return;
    }
    done();
  });

  server.setErrorHandler((error, _request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    if (statusCode === 413) {
      void reply
        .code(413)
        .send({ error: 'BODY_TOO_LARGE' satisfies ErrorCode });
      return;
    }
    if (statusCode === 415) {
      void reply
        .code(415)
        .send({ error: 'UNSUPPORTED_MEDIA_TYPE' satisfies ErrorCode });
      return;
    }
    if (statusCode === 400) {
      void reply.code(400).send({ error: 'BAD_REQUEST' satisfies ErrorCode });
      return;
    }
    void reply.code(503).send({ error: 'UNAVAILABLE' satisfies ErrorCode });
  });

  server.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: 'NOT_FOUND' satisfies ErrorCode });
  });

  server.get('/health', () => {
    return {
      status: 'ok',
      service: 'agent-canvas',
    } satisfies HealthResponse;
  });

  server.get('/', (_request, reply) => {
    const document = createShellDocument(options.shellRandomBytes);
    return reply
      .header('Content-Security-Policy', document.contentSecurityPolicy)
      .type('text/html; charset=utf-8')
      .send(document.html);
  });

  server.get('/assets/main.js', async (_request, reply) => {
    const javascript =
      options.assets?.javascript ?? (await readBuiltAsset('main.js'));
    return reply.type('text/javascript; charset=utf-8').send(javascript);
  });

  server.get('/assets/main.css', async (_request, reply) => {
    const css = options.assets?.css ?? (await readBuiltAsset('main.css'));
    return reply.type('text/css; charset=utf-8').send(css);
  });

  server.post(
    '/session',
    {
      bodyLimit: 1024,
      onRequest: (request, reply, done) => {
        const port = currentPort(server, config);
        if (
          request.headers.origin !== `http://${config.host}:${port.toString()}`
        ) {
          void reply.code(403).send({ error: 'FORBIDDEN' satisfies ErrorCode });
          return;
        }
        if (!isJsonContentType(request.headers['content-type'])) {
          void reply.code(415).send({
            error: 'UNSUPPORTED_MEDIA_TYPE' satisfies ErrorCode,
          });
          return;
        }

        const contentLength = request.headers['content-length'];
        if (contentLength !== undefined && Number(contentLength) > 1024) {
          void reply
            .code(413)
            .send({ error: 'BODY_TOO_LARGE' satisfies ErrorCode });
          return;
        }
        done();
      },
    },
    (request, reply) => {
      if (!isObject(request.body)) {
        return reply
          .code(400)
          .send({ error: 'BAD_REQUEST' satisfies ErrorCode });
      }

      const keys = Object.keys(request.body);
      if (
        keys.some((key) => key !== 'token') ||
        ('token' in request.body && typeof request.body['token'] !== 'string')
      ) {
        return reply
          .code(400)
          .send({ error: 'BAD_REQUEST' satisfies ErrorCode });
      }

      const token = request.body['token'];
      if (typeof token !== 'string') {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED' satisfies ErrorCode });
      }

      const result = sessions.bootstrap(
        token,
        request.headers.cookie,
        currentPort(server, config),
      );
      if (result.status === 'unauthorized') {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED' satisfies ErrorCode });
      }
      if (result.status === 'limit') {
        return reply
          .code(429)
          .send({ error: 'SESSION_LIMIT' satisfies ErrorCode });
      }
      if (result.status === 'created') {
        reply.header('Set-Cookie', result.setCookie);
      }
      return reply.code(204).send();
    },
  );

  return server;
}
