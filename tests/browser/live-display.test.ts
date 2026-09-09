import { afterEach, describe, expect, it } from 'vitest';
import type { Page, Route } from 'playwright';

import type { DisplaySnapshot } from '../../src/contracts/display.js';
import {
  CanvasBrowser,
  CanvasMcpProcess,
  closeCanvasResources,
} from '../helpers/canvas-process.js';
import { createSyntheticEmailFixture } from '../fixtures/synthetic-email.js';

const INSTANCE_A = '123e4567-e89b-42d3-a456-426614174000';
const INSTANCE_B = '223e4567-e89b-42d3-a456-426614174000';

function snapshotEvent(snapshot: DisplaySnapshot): string {
  return (
    `event: snapshot\nid: ${snapshot.instanceId}:${snapshot.revision.toString()}\n` +
    `data: ${JSON.stringify(snapshot)}\n\n`
  );
}

async function openPage(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch {
    throw new Error('The compiled Agent Canvas shell did not open.');
  }
  await page.waitForFunction(() => window.location.hash === '');
}

async function waitForStatus(page: Page, expected: string): Promise<void> {
  await page.waitForFunction(
    (value) =>
      document.querySelector('#connection-status')?.textContent === value,
    expected,
  );
}

async function waitForFrameText(page: Page, expected: string): Promise<void> {
  await page
    .frameLocator('iframe.content-frame')
    .locator('body')
    .filter({ hasText: expected })
    .waitFor({ state: 'visible' });
}

describe('compiled browser live display', () => {
  const processes: CanvasMcpProcess[] = [];
  const browsers: CanvasBrowser[] = [];

  afterEach(async () => {
    await closeCanvasResources([...browsers.splice(0), ...processes.splice(0)]);
  });

  it('authenticates empty and additional tabs, reloads from the cookie, and preserves the shell across replace and clear', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const status = await process.getStatus();
    const origin = new URL(status.browserUrl).origin;

    const first = await browser.newPage();
    await openPage(first, status.browserUrl);
    await waitForStatus(first, 'Connected');
    expect(first.url()).toBe(`${origin}/`);
    expect(await first.locator('#empty-title').textContent()).toBe(
      'Nothing is displayed yet',
    );

    const trustedShellNodes = await first
      .locator(
        '.shell, .shell__header, .shell > section, #connection-status, #empty-title, #empty-detail',
      )
      .elementHandles();
    if (trustedShellNodes.length !== 6) {
      throw new Error('The trusted shell nodes were unavailable.');
    }

    const second = await browser.newPage();
    await openPage(second, status.browserUrl);
    await waitForStatus(second, 'Connected');
    await process.waitForStreamCount(2);

    await second.reload({ waitUntil: 'domcontentloaded' });
    await waitForStatus(second, 'Connected');
    expect(second.url()).toBe(`${origin}/`);
    await process.waitForStreamCount(2);

    const email = createSyntheticEmailFixture();
    await process.present(email.input);
    await waitForFrameText(first, email.sourceBody);
    await waitForFrameText(second, email.recommendation);
    expect(await first.locator('#empty-title').textContent()).toBe(
      'Synthetic launch review',
    );
    const contentRegionBox = await first
      .locator('.content-region')
      .boundingBox();
    const contentFrameBox = await first
      .locator('iframe.content-frame')
      .boundingBox();
    expect(contentRegionBox).not.toBeNull();
    expect(contentFrameBox).not.toBeNull();
    expect(contentFrameBox?.height).toBeGreaterThan(
      (contentRegionBox?.height ?? 0) - 100,
    );
    await second.reload({ waitUntil: 'domcontentloaded' });
    await waitForStatus(second, 'Connected');
    await waitForFrameText(second, email.recommendation);
    expect(second.url()).toBe(`${origin}/`);

    await process.present({
      title: 'Replacement synthetic view',
      html: '<main><p>Replacement marker</p></main>',
      css: 'p { color: navy; }',
    });
    await waitForFrameText(first, 'Replacement marker');
    expect(
      await Promise.all(
        trustedShellNodes.map((element) =>
          element.evaluate((node) => node.isConnected),
        ),
      ),
    ).toEqual([true, true, true, true, true, true]);
    expect(first.url()).toBe(`${origin}/`);

    await process.clear();
    await first
      .locator('#empty-title')
      .filter({ hasText: 'Nothing is displayed yet' })
      .waitFor({ state: 'visible' });
    expect(await first.locator('iframe.content-frame').count()).toBe(0);
    expect(
      await Promise.all(
        trustedShellNodes.map((element) =>
          element.evaluate((node) => node.isConnected),
        ),
      ),
    ).toEqual([true, true, true, true, true, true]);

    await first.goto('about:blank');
    await openPage(first, `${origin}/#token=invalid-token`);
    await waitForStatus(first, 'Access denied');
    await first.waitForTimeout(1_100);
    expect(await first.locator('#connection-status').textContent()).toBe(
      'Access denied',
    );
  }, 30_000);

  it('applies latest snapshot rules and visibly marks a retained view stale while reconnecting', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>)['frameCreations'] = 0;
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLIFrameElement) {
              const target = window as unknown as Record<string, unknown>;
              target['frameCreations'] =
                ((target['frameCreations'] as number | undefined) ?? 0) + 1;
            }
          }
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });

    const status = await process.getStatus();
    const events = [
      {
        instanceId: INSTANCE_A,
        revision: 2,
        view: { title: 'Newest', html: '<p>Newest body</p>', css: '' },
      },
      {
        instanceId: INSTANCE_A,
        revision: 2,
        view: {
          title: 'Duplicate must not repaint',
          html: '<p>Duplicate body</p>',
          css: '',
        },
      },
      {
        instanceId: INSTANCE_A,
        revision: 1,
        view: {
          title: 'Older must not repaint',
          html: '<p>Older body</p>',
          css: '',
        },
      },
      {
        instanceId: INSTANCE_B,
        revision: 0,
        view: {
          title: 'New instance',
          html: '<p>New instance body</p>',
          css: '',
        },
      },
    ] satisfies DisplaySnapshot[];
    let streamAttempts = 0;
    await page.route('**/events', async (route: Route) => {
      streamAttempts += 1;
      if (streamAttempts > 1) {
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: events.map(snapshotEvent).join(''),
      });
    });

    await openPage(page, status.browserUrl);
    await waitForFrameText(page, 'New instance body');
    expect(await page.locator('#empty-title').textContent()).toBe(
      'New instance',
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as Record<string, unknown>)[
            'frameCreations'
          ] as number,
      ),
    ).toBe(2);
    await waitForStatus(page, 'Reconnecting');
    await page
      .locator('#empty-detail')
      .filter({ hasText: 'may be stale' })
      .waitFor({ state: 'visible' });
    expect(
      await page.locator('.content-region').getAttribute('data-stale'),
    ).toBe('true');
  }, 30_000);

  it('stops on 401 and 403 while retrying 429 and 503', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const status = await process.getStatus();
    const origin = new URL(status.browserUrl).origin;

    const unauthenticatedBrowser = await CanvasBrowser.start();
    browsers.push(unauthenticatedBrowser);
    const unauthenticated = await unauthenticatedBrowser.newPage();
    await openPage(unauthenticated, origin);
    await waitForStatus(unauthenticated, 'Disconnected');
    expect(
      await unauthenticated.locator('#empty-detail').textContent(),
    ).toContain('Access denied');

    const forbiddenBrowser = await CanvasBrowser.start();
    browsers.push(forbiddenBrowser);
    const forbidden = await forbiddenBrowser.newPage();
    await forbidden.route('**/events', async (route: Route) => {
      await route.fulfill({ status: 403, body: '' });
    });
    await openPage(forbidden, status.browserUrl);
    await waitForStatus(forbidden, 'Disconnected');
    expect(await forbidden.locator('#empty-detail').textContent()).toContain(
      'Access denied',
    );

    const retryBrowser = await CanvasBrowser.start();
    browsers.push(retryBrowser);
    const retryPage = await retryBrowser.newPage();
    let attempts = 0;
    await retryPage.route('**/events', async (route: Route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 429, body: '' });
        return;
      }
      if (attempts === 2) {
        await route.fulfill({ status: 503, body: '' });
        return;
      }
      await route.continue();
    });
    await openPage(retryPage, status.browserUrl);
    await waitForStatus(retryPage, 'Connected');
    expect(attempts).toBeGreaterThanOrEqual(3);
  }, 30_000);
});
