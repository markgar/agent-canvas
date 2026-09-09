import { describe, expect, it } from 'vitest';

import { BrowserSessions, type RandomBytes } from './browser-sessions.js';

function incrementingRandom(start = 1): RandomBytes {
  let value = start;
  return (size) => {
    const bytes = new Uint8Array(size);
    bytes.fill(value);
    value += 1;
    return bytes;
  };
}

function createdCookie(sessions: BrowserSessions, port = 3000): string {
  const result = sessions.bootstrap(sessions.bootstrapToken, undefined, port);
  expect(result.status).toBe('created');
  if (result.status !== 'created') {
    throw new Error('Expected a new browser session.');
  }
  return result.setCookie.split(';', 1)[0] ?? '';
}

describe('BrowserSessions', () => {
  it('creates a per-process 32-byte fragment secret and port-specific cookie', () => {
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
    });

    expect(sessions.bootstrapToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessions.accessUrl(4312)).toBe(
      `http://127.0.0.1:4312/#token=${sessions.bootstrapToken}`,
    );

    const result = sessions.bootstrap(sessions.bootstrapToken, undefined, 4312);
    expect(result).toMatchObject({ status: 'created' });
    if (result.status !== 'created') {
      throw new Error('Expected a new browser session.');
    }
    expect(result.setCookie).toMatch(
      /^agent_canvas_session_4312=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    expect(result.setCookie).not.toMatch(/(?:Secure|Domain|Expires|Max-Age)/i);
    expect(sessions.authenticate(result.setCookie, 4312)).toBe(true);
    expect(sessions.authenticate(result.setCookie, 4313)).toBe(false);
  });

  it('requires the bootstrap secret even when a valid cookie is supplied', () => {
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
    });
    const cookie = createdCookie(sessions);

    expect(sessions.bootstrap('wrong', cookie, 3000)).toEqual({
      status: 'unauthorized',
    });
    expect(sessions.sessionCount).toBe(1);
  });

  it('reuses a valid cookie without rotation or allocation, including at cap', () => {
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      sessionLimit: 2,
    });
    const first = createdCookie(sessions);
    createdCookie(sessions);

    expect(sessions.sessionCount).toBe(2);
    expect(sessions.bootstrap(sessions.bootstrapToken, first, 3000)).toEqual({
      status: 'reused',
    });
    expect(sessions.sessionCount).toBe(2);
    expect(
      sessions.bootstrap(sessions.bootstrapToken, undefined, 3000),
    ).toEqual({ status: 'limit' });
  });

  it('enforces the default 32-record allocation cap while allowing reuse', () => {
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
    });
    const cookies = Array.from({ length: 32 }, () => createdCookie(sessions));

    expect(sessions.sessionCount).toBe(32);
    expect(
      sessions.bootstrap(sessions.bootstrapToken, undefined, 3000),
    ).toEqual({ status: 'limit' });
    expect(
      sessions.bootstrap(sessions.bootstrapToken, cookies[0], 3000),
    ).toEqual({ status: 'reused' });
    expect(sessions.sessionCount).toBe(32);
  });

  it('uses the default 24-hour elapsed idle lifetime', () => {
    let now = 0;
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      now: () => now,
    });
    createdCookie(sessions);

    now = 24 * 60 * 60 * 1000 - 1;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(1);
    now += 1;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(0);
  });

  it('does not let unauthenticated requests extend an idle session', () => {
    let now = 0;
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      now: () => now,
      idleTimeoutMs: 1_000,
    });
    createdCookie(sessions);

    now = 999;
    expect(sessions.authenticate('wrong=value', 3000)).toBe(false);
    expect(sessions.bootstrap('wrong', undefined, 3000)).toEqual({
      status: 'unauthorized',
    });
    now = 1_000;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(0);
  });

  it('validates a cookie without extending its idle lifetime', () => {
    let now = 0;
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      now: () => now,
      idleTimeoutMs: 1_000,
    });
    const cookie = createdCookie(sessions);

    now = 999;
    expect(sessions.validate(cookie, 3000)).toBe(true);
    expect(sessions.activeStreamCount).toBe(0);
    now = 1_000;
    expect(sessions.validate(cookie, 3000)).toBe(false);
    expect(sessions.sessionCount).toBe(0);
  });

  it('expires idle sessions at the exact elapsed-time boundary', () => {
    let now = 100;
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      now: () => now,
      idleTimeoutMs: 1_000,
      sessionLimit: 1,
    });
    const cookie = createdCookie(sessions);

    now = 1_099;
    expect(sessions.authenticate(cookie, 3000)).toBe(true);
    now = 2_098;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(1);
    now = 2_099;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(0);
    expect(sessions.authenticate(cookie, 3000)).toBe(false);
    expect(
      sessions.bootstrap(sessions.bootstrapToken, undefined, 3000).status,
    ).toBe('created');
  });

  it('keeps active streams live and starts idleness when the last closes', () => {
    let now = 0;
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
      now: () => now,
      idleTimeoutMs: 1_000,
    });
    const cookie = createdCookie(sessions);
    const closeFirst = sessions.openStream(cookie, 3000);
    const closeSecond = sessions.openStream(cookie, 3000);

    expect(closeFirst).toBeTypeOf('function');
    expect(closeSecond).toBeTypeOf('function');
    expect(sessions.activeStreamCount).toBe(2);
    now = 10_000;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(1);

    closeFirst?.();
    expect(sessions.activeStreamCount).toBe(1);
    closeSecond?.();
    closeSecond?.();
    expect(sessions.activeStreamCount).toBe(0);
    now = 10_999;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(1);
    now = 11_000;
    sessions.pruneExpired();
    expect(sessions.sessionCount).toBe(0);
  });

  it('invalidates credentials when a fresh process creates new secrets', () => {
    const first = new BrowserSessions({
      randomBytes: incrementingRandom(1),
    });
    const oldCookie = createdCookie(first);
    const second = new BrowserSessions({
      randomBytes: incrementingRandom(20),
    });

    expect(second.bootstrap(first.bootstrapToken, oldCookie, 3000)).toEqual({
      status: 'unauthorized',
    });
    expect(second.authenticate(oldCookie, 3000)).toBe(false);
  });

  it('rejects duplicate session-cookie names and invalid random lengths', () => {
    const sessions = new BrowserSessions({
      randomBytes: incrementingRandom(),
    });
    const cookie = createdCookie(sessions);
    expect(sessions.authenticate(`${cookie}; ${cookie}`, 3000)).toBe(false);

    expect(
      () =>
        new BrowserSessions({
          randomBytes: () => new Uint8Array(31),
        }),
    ).toThrow('invalid secret length');
  });
});
