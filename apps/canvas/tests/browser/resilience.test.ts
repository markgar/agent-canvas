import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';

import type { DisplaySnapshot } from '../../src/contracts/display.js';
import {
  DisplayConnection,
  type ConnectionScheduler,
} from '../../src/client/shell/connection.js';
import {
  createSseConnection,
  formatSnapshotEvent,
  type SseConnectionWriter,
} from '../../src/server/http/sse-connection.js';
import {
  CanvasBrowser,
  CanvasMcpProcess,
  closeCanvasResources,
  observeFrameTextAfterAnimationFrame,
  openAuthenticatedCanvas,
} from '../helpers/canvas-process.js';

const INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';

function snapshot(revision: number): DisplaySnapshot {
  return {
    instanceId: INSTANCE_ID,
    revision,
    view: {
      title: `Synthetic resilience ${revision.toString()}`,
      html: `<p>Resilience marker ${revision.toString()}</p>`,
      css: '',
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function scheduler(): ConnectionScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => {
      clearTimeout(handle);
    },
  };
}

async function waitForStatus(
  page: Page,
  expected: string,
  timeout = 5_000,
): Promise<void> {
  await page.waitForFunction(
    (value) =>
      document.querySelector('#connection-status')?.textContent === value,
    expected,
    { timeout },
  );
}

class SlowWriter implements SseConnectionWriter {
  readonly chunks: string[] = [];
  readonly destroy = vi.fn();
  readonly #listeners = new Map<
    'close' | 'drain' | 'error',
    Set<(...arguments_: unknown[]) => void>
  >();

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return false;
  }

  on(
    event: 'close' | 'drain' | 'error',
    listener: (...arguments_: unknown[]) => void,
  ): void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
  }

  off(
    event: 'close' | 'drain' | 'error',
    listener: (...arguments_: unknown[]) => void,
  ): void {
    this.#listeners.get(event)?.delete(listener);
  }

  emit(event: 'close' | 'drain' | 'error'): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      listener();
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LIVE-011 resilience', () => {
  const processes: CanvasMcpProcess[] = [];
  const browsers: CanvasBrowser[] = [];

  afterEach(async () => {
    await closeCanvasResources([...browsers.splice(0), ...processes.splice(0)]);
  });

  it('marks a foreground retained view stale within 15 seconds of a silent stream and recovers', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const page = await browser.newPage();
    const status = await process.getStatus();
    await openAuthenticatedCanvas(page, status.browserUrl);
    await page.bringToFront();

    await process.present({
      title: 'Synthetic loss evidence',
      html: '<p>Silent stream marker</p>',
      css: '',
    });
    await observeFrameTextAfterAnimationFrame(page, 'Silent stream marker');

    await page.evaluate(() => {
      const target = window as unknown as Record<string, unknown>;
      target['lossStartedAt'] = performance.now();
      target['disconnectedAt'] = null;
      const statusElement = document.querySelector('#connection-status');
      if (statusElement === null) {
        throw new Error('Connection status is unavailable.');
      }
      const observer = new MutationObserver(() => {
        if (statusElement.textContent === 'Disconnected') {
          target['disconnectedAt'] = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(statusElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    process.suspend();

    try {
      await waitForStatus(page, 'Disconnected', 16_000);
      const elapsed = await page.evaluate(() => {
        const target = window as unknown as Record<string, unknown>;
        return (
          (target['disconnectedAt'] as number) -
          (target['lossStartedAt'] as number)
        );
      });
      globalThis.process.stderr.write(
        `Agent Canvas loss evidence: ${JSON.stringify({
          requirement: 'LIVE-011',
          disconnectedWithinMs: elapsed,
        })}\n`,
      );
      expect(elapsed).toBeLessThanOrEqual(15_000);
      expect(
        await page.locator('.content-region').getAttribute('data-stale'),
      ).toBe('true');
      expect(await page.locator('#empty-detail').textContent()).toContain(
        'may be stale',
      );
    } finally {
      process.resume();
    }

    await waitForStatus(page, 'Connected', 10_000);
    expect(
      await page.locator('.content-region').getAttribute('data-stale'),
    ).toBe('false');
  }, 45_000);

  it('times out each attempt and continues one-at-a-time retries even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      if (init?.signal === undefined || init.signal === null) {
        throw new Error('Expected a connection abort signal.');
      }
      signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    });
    const statuses: string[] = [];
    const connection = new DisplayConnection({
      fetch: fetchMock,
      scheduler: scheduler(),
      onSnapshot: vi.fn(),
      onStatus: (status) => statuses.push(status),
      onStale: vi.fn(),
      onTerminalFailure: vi.fn(),
    });

    connection.start();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(statuses.at(-1)).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals.filter((signal) => !signal.aborted)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(signals[1]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals.filter((signal) => !signal.aborted)).toHaveLength(1);

    connection.stop();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('retains only the latest pending snapshot and evicts a slow writer after five seconds', () => {
    vi.useFakeTimers();
    const writer = new SlowWriter();
    const onClose = vi.fn();
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose,
    });

    for (let revision = 1; revision <= 1_000; revision += 1) {
      connection.publish(snapshot(revision));
    }
    expect(writer.chunks).toEqual([formatSnapshotEvent(snapshot(0))]);

    writer.emit('drain');
    expect(writer.chunks).toEqual([
      formatSnapshotEvent(snapshot(0)),
      formatSnapshotEvent(snapshot(1_000)),
    ]);
    vi.advanceTimersByTime(4_999);
    expect(connection.closed).toBe(false);
    vi.advanceTimersByTime(1);

    expect(connection.closed).toBe(true);
    expect(writer.destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('releases the authenticated connection count when a compiled browser tab closes', async () => {
    const process = await CanvasMcpProcess.start();
    processes.push(process);
    const browser = await CanvasBrowser.start();
    browsers.push(browser);
    const page = await browser.newPage();
    const status = await process.getStatus();
    await openAuthenticatedCanvas(page, status.browserUrl);
    await page.bringToFront();
    await process.waitForStreamCount(1);

    await page.close();
    await process.waitForStreamCount(0);
  });
});
