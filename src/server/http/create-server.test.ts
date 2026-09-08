import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { healthResponseSchema } from '../../contracts/health.js';
import { BrowserSessions } from '../security/browser-sessions.js';
import { createServer } from './create-server.js';

const host = '127.0.0.1:3000';
const origin = 'http://127.0.0.1:3000';

function incrementingRandom(start = 1) {
  let value = start;
  return (size: number) => new Uint8Array(size).fill(value++);
}

describe('createServer', () => {
  let sessions: BrowserSessions;
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
    });
    server = createServer(
      { host: '127.0.0.1', port: 3000 },
      {
        sessions,
        shellRandomBytes: incrementingRandom(20),
        assets: {
          javascript: 'document.title = "Agent Canvas";',
          css: 'body { margin: 0; }',
        },
      },
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it('preserves the public content-free health contract and global headers', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { host },
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: 'ok',
      service: 'agent-canvas',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('serves a public content-free shell with fresh nonce policies', async () => {
    const first = await server.inject({
      method: 'GET',
      url: '/',
      headers: { host },
    });
    const second = await server.inject({
      method: 'GET',
      url: '/',
      headers: { host },
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(first.headers['content-security-policy']).toMatch(
      /^default-src 'none'; script-src 'self'; style-src 'self' 'nonce-[A-Za-z0-9_-]{22}'; style-src-attr 'none'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/,
    );
    expect(first.headers['content-security-policy']).not.toBe(
      second.headers['content-security-policy'],
    );
    expect(first.body).toContain('Nothing is displayed yet');
    expect(first.body).not.toMatch(
      new RegExp(
        `${sessions.bootstrapToken}|agent_canvas_session|DisplaySnapshot`,
        'i',
      ),
    );
    expect(first.headers['set-cookie']).toBeUndefined();
  });

  it('serves only explicit local shell assets with correct MIME types', async () => {
    const javascript = await server.inject({
      method: 'GET',
      url: '/assets/main.js',
      headers: { host },
    });
    const css = await server.inject({
      method: 'GET',
      url: '/assets/main.css',
      headers: { host },
    });

    expect(javascript.statusCode).toBe(200);
    expect(javascript.headers['content-type']).toBe(
      'text/javascript; charset=utf-8',
    );
    expect(javascript.body).toBe('document.title = "Agent Canvas";');
    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toBe('body { margin: 0; }');
  });

  it.each([
    { host: 'attacker.example:3000' },
    { host: '127.0.0.1:3001' },
    { host, origin: 'https://attacker.example' },
    { host, origin: 'null' },
  ])(
    'rejects invalid browser boundaries with JSON only: %j',
    async (headers) => {
      const response = await server.inject({ url: '/health', headers });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'FORBIDDEN' });
      const reflected = 'origin' in headers ? headers.origin : headers.host;
      expect(response.body).not.toContain(reflected);
    },
  );

  it('uses the bound Host and Origin before parsing bootstrap input', async () => {
    const wrongHost = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host: 'attacker.example:3000',
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      payload: '{',
    });
    expect(wrongHost.statusCode).toBe(403);
    expect(wrongHost.json()).toEqual({ error: 'FORBIDDEN' });

    const wrongOrigin = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host,
        origin: 'https://attacker.example',
        'content-type': 'text/plain',
      },
      payload: 'x'.repeat(2_000),
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toEqual({ error: 'FORBIDDEN' });
  });

  it('requires an exact bootstrap Origin without trusting forwarded authority', async () => {
    const missingOrigin = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host,
        'content-type': 'application/json',
        'x-forwarded-host': host,
        'x-forwarded-proto': 'http',
      },
      payload: JSON.stringify({ token: sessions.bootstrapToken }),
    });
    expect(missingOrigin.statusCode).toBe(403);

    const forwardedOnly = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host: 'attacker.example:3000',
        origin,
        'content-type': 'application/json',
        'x-forwarded-host': host,
      },
      payload: JSON.stringify({ token: sessions.bootstrapToken }),
    });
    expect(forwardedOnly.statusCode).toBe(403);
  });

  it.each([
    undefined,
    'text/plain',
    'application/json-patch+json',
    'application/json; charset=iso-8859-1',
    'application/json; charset=utf-8; version=1',
  ])('rejects unsupported bootstrap media type %j', async (contentType) => {
    const headers: Record<string, string> = { host, origin };
    if (contentType !== undefined) {
      headers['content-type'] = contentType;
    }
    const response = await server.inject({
      method: 'POST',
      url: '/session',
      headers,
      payload: '{}',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      error: 'UNSUPPORTED_MEDIA_TYPE',
    });
  });

  it.each([
    'application/json',
    'Application/JSON; Charset=UTF-8',
    'application/json; charset = "utf-8"',
  ])('accepts the approved JSON media type %j', async (contentType) => {
    const response = await server.inject({
      method: 'POST',
      url: '/session',
      headers: { host, origin, 'content-type': contentType },
      payload: JSON.stringify({ token: sessions.bootstrapToken }),
    });
    expect(response.statusCode).toBe(204);
  });

  it('bounds bootstrap bodies before JSON parsing', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/session',
      headers: { host, origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: 'x'.repeat(1_100) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: 'BODY_TOO_LARGE' });
    expect(response.body).not.toContain('xxxx');
  });

  it.each([
    { payload: '{', status: 400, error: 'BAD_REQUEST' },
    { payload: 'null', status: 400, error: 'BAD_REQUEST' },
    { payload: '[]', status: 400, error: 'BAD_REQUEST' },
    { payload: '"token"', status: 400, error: 'BAD_REQUEST' },
    { payload: '{"token":1}', status: 400, error: 'BAD_REQUEST' },
    {
      payload: '{"token":"wrong","extra":true}',
      status: 400,
      error: 'BAD_REQUEST',
    },
    { payload: '{}', status: 401, error: 'UNAUTHORIZED' },
    { payload: '{"token":""}', status: 401, error: 'UNAUTHORIZED' },
    { payload: '{"token":"wrong"}', status: 401, error: 'UNAUTHORIZED' },
  ])(
    'returns the specified safe error for bootstrap body $payload',
    async ({ payload, status, error }) => {
      const response = await server.inject({
        method: 'POST',
        url: '/session',
        headers: { host, origin, 'content-type': 'application/json' },
        payload,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ error });
      expect(response.body).toBe(JSON.stringify({ error }));
    },
  );

  it('creates and reuses a host-only session cookie without rotation', async () => {
    const first = await server.inject({
      method: 'POST',
      url: '/session',
      headers: { host, origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: sessions.bootstrapToken }),
    });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    expect(first.headers['set-cookie']).toMatch(
      /^agent_canvas_session_3000=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    const cookie = first.headers['set-cookie'];
    expect(cookie).toBeTypeOf('string');

    const second = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host,
        origin,
        'content-type': 'application/json',
        cookie: String(cookie).split(';', 1)[0] ?? '',
      },
      payload: JSON.stringify({ token: sessions.bootstrapToken }),
    });
    expect(second.statusCode).toBe(204);
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(sessions.sessionCount).toBe(1);
  });

  it('returns SESSION_LIMIT only when allocation would exceed the cap', async () => {
    const limitedSessions = new BrowserSessions({
      randomBytes: incrementingRandom(40),
      sessionLimit: 1,
    });
    const limitedServer = createServer(
      { host: '127.0.0.1', port: 3000 },
      {
        sessions: limitedSessions,
        assets: { javascript: '', css: '' },
      },
    );
    await server.close();
    server = limitedServer;

    const first = await server.inject({
      method: 'POST',
      url: '/session',
      headers: { host, origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: limitedSessions.bootstrapToken }),
    });
    expect(first.statusCode).toBe(204);

    const atCap = await server.inject({
      method: 'POST',
      url: '/session',
      headers: { host, origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ token: limitedSessions.bootstrapToken }),
    });
    expect(atCap.statusCode).toBe(429);
    expect(atCap.json()).toEqual({ error: 'SESSION_LIMIT' });

    const reuse = await server.inject({
      method: 'POST',
      url: '/session',
      headers: {
        host,
        origin,
        'content-type': 'application/json',
        cookie: String(first.headers['set-cookie']).split(';', 1)[0] ?? '',
      },
      payload: JSON.stringify({ token: limitedSessions.bootstrapToken }),
    });
    expect(reuse.statusCode).toBe(204);
    expect(reuse.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    { method: 'GET' as const, url: '/session' },
    { method: 'POST' as const, url: '/health' },
    { method: 'HEAD' as const, url: '/health' },
    { method: 'OPTIONS' as const, url: '/session' },
    { method: 'GET' as const, url: '/api/display' },
    { method: 'GET' as const, url: '/package.json' },
  ])('returns safe JSON for unregistered $method $url', async (request) => {
    const response = await server.inject({
      ...request,
      headers: { host },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'NOT_FOUND' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
