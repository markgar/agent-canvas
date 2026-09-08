import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

import { healthResponseSchema } from '../../src/contracts/health.js';
import { readConfig } from '../../src/server/config.js';
import { createServer } from '../../src/server/http/create-server.js';
import { BrowserSessions } from '../../src/server/security/browser-sessions.js';

describe('HTTP listener', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  const browsers: Browser[] = [];

  afterEach(async () => {
    await Promise.all(browsers.map((browser) => browser.close()));
    browsers.length = 0;
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('listens on an ephemeral loopback port and serves its contract', async () => {
    const config = readConfig({});
    const server = createServer(config);
    servers.push(server);
    const address = await server.listen(config);

    expect(new URL(address).hostname).toBe('127.0.0.1');
    expect(new URL(address).port).not.toBe('0');

    const response = await fetch(`${address}/health`);
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json()).status).toBe('ok');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('fails rather than silently moving off an explicitly occupied port', async () => {
    const config = readConfig({});
    const first = createServer(config);
    servers.push(first);
    const address = await first.listen(config);
    const second = createServer(config);
    servers.push(second);

    await expect(
      second.listen({ host: config.host, port: Number(new URL(address).port) }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('bootstraps the compiled trusted shell without leaking or persisting credentials', async () => {
    let fill = 1;
    const sessions = new BrowserSessions({
      randomBytes: (size) => new Uint8Array(size).fill(fill++),
    });
    const config = readConfig({});
    const server = createServer(config, { sessions });
    servers.push(server);
    const address = await server.listen(config);
    const port = Number(new URL(address).port);

    const publicShell = await fetch(`${address}/`);
    expect(publicShell.status).toBe(200);
    expect(publicShell.headers.get('content-security-policy')).toMatch(
      /style-src 'self' 'nonce-[A-Za-z0-9_-]{22}'/,
    );
    const publicHtml = await publicShell.text();
    expect(publicHtml.includes(sessions.bootstrapToken)).toBe(false);
    expect(publicHtml).not.toContain('agent_canvas_session');

    const browser = await chromium.launch();
    browsers.push(browser);
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => {
      requests.push(request.url());
    });

    await page.goto(sessions.accessUrl(port));
    await page.waitForFunction(
      () =>
        document.querySelector('#connection-status')?.textContent ===
        'Session ready',
    );

    expect(page.url()).toBe(`${address}/`);
    expect(requests.some((url) => url.includes(sessions.bootstrapToken))).toBe(
      false,
    );
    expect(
      requests.every((url) => new URL(url).origin === new URL(address).origin),
    ).toBe(true);
    expect(
      requests.filter((url) => new URL(url).pathname === '/session'),
    ).toHaveLength(1);

    const cookies = await context.cookies(address);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: `agent_canvas_session_${port.toString()}`,
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      path: '/',
      expires: -1,
    });

    expect(
      await page.evaluate(async () => ({
        local: localStorage.length,
        session: sessionStorage.length,
        caches: (await window.caches.keys()).length,
        serviceWorkers: (await navigator.serviceWorker.getRegistrations())
          .length,
      })),
    ).toEqual({
      local: 0,
      session: 0,
      caches: 0,
      serviceWorkers: 0,
    });

    const invalidPage = await context.newPage();
    invalidPage.on('request', (request) => {
      requests.push(request.url());
    });
    await invalidPage.goto(`${address}/#token=wrong`);
    await invalidPage.waitForFunction(
      () =>
        document.querySelector('#connection-status')?.textContent ===
        'Access denied',
    );
    expect(invalidPage.url()).toBe(`${address}/`);
    expect(
      requests.filter((url) => new URL(url).pathname === '/session'),
    ).toHaveLength(2);
    expect(await context.cookies(address)).toHaveLength(1);
  }, 30_000);

  it('abandons a stalled bootstrap after 15 seconds', async () => {
    const sessions = new BrowserSessions({
      randomBytes: (size) => new Uint8Array(size).fill(7),
    });
    const config = readConfig({});
    const server = createServer(config, { sessions });
    servers.push(server);
    const address = await server.listen(config);
    const port = Number(new URL(address).port);

    const browser = await chromium.launch();
    browsers.push(browser);
    const page = await browser.newPage();
    let bootstrapRequests = 0;
    await page.route('**/session', () => {
      bootstrapRequests += 1;
    });

    const startedAt = performance.now();
    await page.goto(sessions.accessUrl(port));
    await page.waitForFunction(
      () =>
        document.querySelector('#connection-status')?.textContent ===
        'Unavailable',
      undefined,
      { timeout: 20_000 },
    );
    const elapsedMs = performance.now() - startedAt;

    expect(page.url()).toBe(`${address}/`);
    expect(bootstrapRequests).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(14_500);
    expect(elapsedMs).toBeLessThan(20_000);
    expect(await page.locator('#empty-detail').textContent()).toBe(
      'The local Agent Canvas session could not be established.',
    );
  }, 25_000);
});
