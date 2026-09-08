import Fastify from 'fastify';

import type { HealthResponse } from '../../contracts/health.js';
import type { ServerConfig } from '../config.js';

export function createServer(config: ServerConfig) {
  const server = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
  });

  server.addHook('onRequest', (request, reply, done) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');

    const address = server.server.address();
    const port =
      address !== null && typeof address !== 'string'
        ? address.port
        : config.port;
    const authority = `${config.host}:${port.toString()}`;

    if (request.headers.host !== authority) {
      void reply.code(403).send({ error: 'Host not allowed' });
      return;
    }

    if (
      request.headers.origin !== undefined &&
      request.headers.origin !== `http://${authority}`
    ) {
      void reply.code(403).send({ error: 'Origin not allowed' });
      return;
    }
    done();
  });

  server.get('/health', () => {
    return {
      status: 'ok',
      service: 'agent-canvas',
    } satisfies HealthResponse;
  });

  return server;
}
