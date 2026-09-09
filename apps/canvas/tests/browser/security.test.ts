import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';

import {
  CanvasBrowser,
  CanvasMcpProcess,
  closeCanvasResources,
} from '../helpers/canvas-process.js';
import { createSyntheticEmailFixture } from '../fixtures/synthetic-email.js';

async function openAuthenticated(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch {
    throw new Error('The compiled Agent Canvas shell did not open.');
  }
  await page.waitForFunction(() => window.location.hash === '');
  await page.waitForFunction(
    () =>
      document.querySelector('#connection-status')?.textContent === 'Connected',
  );
}

describe('compiled browser security boundaries', () => {
  const processes: CanvasMcpProcess[] = [];
  const browsers: CanvasBrowser[] = [];

  afterEach(async () => {
    await closeCanvasResources([...browsers.splice(0), ...processes.splice(0)]);
  });

  it('keeps trusted shell identity visible and isolates hostile content while legitimate CSS renders', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const status = await process.getStatus();
    const origin = new URL(status.browserUrl).origin;
    const page = await browser.newPage();
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('http') && !url.startsWith(origin)) {
        remoteRequests.push(url);
      }
    });
    await openAuthenticated(page, status.browserUrl);

    await process.present({
      title: 'Legitimate style rendering',
      html: '<p class="styled" style="color: rgb(180, 0, 0); font-weight: 700">Styled marker</p>',
      css: '.styled { color: rgb(0, 0, 180); background-color: #f0f0f0; }',
    });
    await page
      .frameLocator('iframe.content-frame')
      .locator('body')
      .filter({ hasText: 'Styled marker' })
      .waitFor({ state: 'visible' });
    const computed = await page
      .frameLocator('iframe.content-frame')
      .locator('.styled')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontWeight: style.fontWeight,
        };
      });
    expect(computed).toEqual({
      color: 'rgb(180, 0, 0)',
      backgroundColor: 'rgb(240, 240, 240)',
      fontWeight: '700',
    });

    await process.present({
      title: '<img src=x onerror=alert(1)> Trusted title text',
      html:
        '<script>window.top.document.body.textContent="bad"</script>' +
        '<style>body{display:none}</style><style></style><script>bad()</script>' +
        '<svg><script>alert(1)</script><text>svg marker</text></svg>' +
        '<form action="https://remote.invalid/submit"><input name="secret"></form>' +
        '<iframe src="https://remote.invalid/frame"></iframe>' +
        '<img src="https://remote.invalid/pixel">' +
        '<a href="https://remote.invalid/navigation">Safe link text</a>' +
        '<p style="color: navy; background-image: url(https://remote.invalid/inline)">Hostile marker</p>',
      css:
        '.shell { display: none; }' +
        'p { background-image: url(https://remote.invalid/style); }' +
        '</style><script>window.top.location="https://remote.invalid/breakout"</script>',
    });

    await page
      .frameLocator('iframe.content-frame')
      .locator('body')
      .filter({ hasText: 'Hostile marker' })
      .waitFor({ state: 'visible' });

    expect(await page.locator('.shell__eyebrow').isVisible()).toBe(true);
    expect(await page.locator('#connection-status').isVisible()).toBe(true);
    expect(await page.locator('#empty-title').textContent()).toBe(
      '<img src=x onerror=alert(1)> Trusted title text',
    );
    expect(
      await page
        .frameLocator('iframe.content-frame')
        .locator(
          'body script, body style, body svg, body form, body input, body iframe, body img, body a',
        )
        .count(),
    ).toBe(0);
    expect(
      await page
        .frameLocator('iframe.content-frame')
        .locator('body')
        .textContent()
        .then((text) => text?.includes('Safe link text')),
    ).toBe(true);

    const frame = page.locator('iframe.content-frame');
    expect(await frame.getAttribute('sandbox')).toBe('');
    const source = await frame.getAttribute('srcdoc');
    expect(source?.includes("default-src 'none'")).toBe(true);
    expect(source?.includes('remote.invalid')).toBe(false);
    expect(remoteRequests).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(
      await page.evaluate(async () =>
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations()).length
          : 0,
      ),
    ).toBe(0);
  }, 30_000);

  it('shows only known synthetic email headers and keeps public or failed responses content-free', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const status = await process.getStatus();
    const accessUrl = new URL(status.browserUrl);
    const token =
      new URLSearchParams(accessUrl.hash.slice(1)).get('token') ?? '';
    const page = await browser.newPage();
    await openAuthenticated(page, status.browserUrl);

    const fixture = createSyntheticEmailFixture({
      omitRecipientAndDate: true,
    });
    await process.present(fixture.input);
    const frame = page.frameLocator('iframe.content-frame');
    await frame
      .locator('body')
      .filter({ hasText: fixture.sourceBody })
      .waitFor({ state: 'visible' });
    for (const header of fixture.visibleHeaders) {
      expect(await frame.locator('dt', { hasText: header }).count()).toBe(1);
    }
    for (const header of fixture.omittedHeaders) {
      expect(await frame.locator('dt', { hasText: header }).count()).toBe(0);
    }
    expect(await frame.locator('.source-body').textContent()).toContain(
      fixture.sourceBody,
    );
    expect(await frame.locator('.recommendation').textContent()).toContain(
      fixture.recommendation,
    );
    expect(
      await frame
        .locator('.source-body')
        .evaluate((element) => getComputedStyle(element).borderTopWidth),
    ).not.toBe(
      await frame
        .locator('.recommendation')
        .evaluate((element) => getComputedStyle(element).borderTopWidth),
    );

    const [root, javascript, css, unauthorized] = await Promise.all([
      fetch(`${accessUrl.origin}/`),
      fetch(`${accessUrl.origin}/assets/main.js`),
      fetch(`${accessUrl.origin}/assets/main.css`),
      fetch(`${accessUrl.origin}/events`),
    ]);
    const [rootText, javascriptText, cssText] = await Promise.all([
      root.text(),
      javascript.text(),
      css.text(),
    ]);
    const unauthorizedBody: unknown = await unauthorized.json();
    for (const body of [rootText, javascriptText, cssText]) {
      expect(body.includes(fixture.sourceBody)).toBe(false);
      expect(body.includes(fixture.recommendation)).toBe(false);
      expect(body.includes(token)).toBe(false);
      expect(body.includes('agent_canvas_session_')).toBe(false);
    }
    expect(unauthorized.status).toBe(401);
    expect(unauthorizedBody).toEqual({ error: 'UNAUTHORIZED' });
    for (const response of [root, javascript, css, unauthorized]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
  }, 30_000);
});
