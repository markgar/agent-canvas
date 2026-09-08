import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { healthResponseSchema } from '../../contracts/health.js';
import { createServer } from './create-server.js';

describe('createServer', () => {
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    server = createServer({ host: '127.0.0.1', port: 3000 });
  });

  afterEach(async () => {
    await server.close();
  });

  it('serves a non-sensitive, non-cacheable liveness response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host: '127.0.0.1:3000' },
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      service: 'agent-canvas',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    { host: 'attacker.example:3000' },
    { host: '127.0.0.1:3001' },
    { host: '127.0.0.1:3000', origin: 'https://attacker.example' },
    { host: '127.0.0.1:3000', origin: 'null' },
  ])('rejects invalid browser boundaries: %j', async (headers) => {
    const response = await server.inject({ url: '/health', headers });
    expect(response.statusCode).toBe(403);
  });

  it('allows same-origin requests', async () => {
    const response = await server.inject({
      url: '/health',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it('does not pretend that display endpoints exist', async () => {
    const response = await server.inject({
      url: '/api/display',
      headers: { host: '127.0.0.1:3000' },
    });
    expect(response.statusCode).toBe(404);
  });
});
