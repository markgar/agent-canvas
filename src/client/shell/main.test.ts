import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisplaySnapshot } from '../../contracts/display.js';
import type { ConnectionStatus } from './connection.js';

interface ConnectionOptions {
  onSnapshot(snapshot: DisplaySnapshot, action: 'replace' | 'ignore'): void;
  onStatus(status: ConnectionStatus): void;
  onStale(stale: boolean): void;
  onTerminalFailure(failure: 'access' | 'response'): void;
}

interface FakeElement {
  dataset: Record<string, string>;
  hidden: boolean;
  nonce?: string;
  textContent: string;
}

const harness = vi.hoisted(() => ({
  connectionOptions: [] as ConnectionOptions[],
  connectionStarts: 0,
  connectionStops: 0,
  renderCalls: [] as Array<DisplaySnapshot['view']>,
  staleCalls: [] as boolean[],
}));

vi.mock('./connection.js', () => ({
  DisplayConnection: class {
    public constructor(options: ConnectionOptions) {
      harness.connectionOptions.push(options);
    }

    public start(): void {
      harness.connectionStarts += 1;
    }

    public stop(): void {
      harness.connectionStops += 1;
    }
  },
}));

vi.mock('../rendering/frame.js', () => ({
  FrameRenderer: class {
    public render(view: DisplaySnapshot['view']): void {
      harness.renderCalls.push(view);
    }

    public setStale(stale: boolean): void {
      harness.staleCalls.push(stale);
    }
  },
}));

function createBrowserHarness(hash: string): {
  elements: Record<string, FakeElement>;
  listeners: Map<string, () => void>;
  replaceState: ReturnType<typeof vi.fn>;
} {
  const elements: Record<string, FakeElement> = {
    '#connection-status': {
      dataset: {},
      hidden: false,
      textContent: '',
    },
    '.empty-state': {
      dataset: {},
      hidden: false,
      textContent: '',
    },
    '#empty-title': {
      dataset: {},
      hidden: false,
      textContent: '',
    },
    '#empty-detail': {
      dataset: {},
      hidden: false,
      textContent: '',
    },
    'link[nonce]': {
      dataset: {},
      hidden: false,
      nonce: 'AQEBAQEBAQEBAQEBAQEBAQ',
      textContent: '',
    },
  };
  const listeners = new Map<string, () => void>();
  const replaceState = vi.fn();
  const document = {
    hidden: false,
    querySelector(selector: string) {
      return elements[selector] ?? null;
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(`document:${type}`, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(`document:${type}`);
    },
  };
  const window = {
    location: {
      hash,
      pathname: '/',
      search: '',
    },
    history: { replaceState },
    addEventListener(type: string, listener: () => void) {
      listeners.set(`window:${type}`, listener);
    },
    setTimeout,
    clearTimeout,
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  return { elements, listeners, replaceState };
}

async function loadShell(): Promise<void> {
  await import('./main.js');
  await Promise.resolve();
}

function element(
  browser: ReturnType<typeof createBrowserHarness>,
  selector: string,
): FakeElement {
  const value = browser.elements[selector];
  if (value === undefined) {
    throw new Error(`Missing fake element: ${selector}`);
  }
  return value;
}

describe('browser shell entry point', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    harness.connectionOptions.length = 0;
    harness.connectionStarts = 0;
    harness.connectionStops = 0;
    harness.renderCalls.length = 0;
    harness.staleCalls.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exchanges a supplied token, starts streaming, and handles display lifecycle callbacks', async () => {
    const browser = createBrowserHarness('#token=local-bootstrap-token');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await loadShell();
    await vi.advanceTimersByTimeAsync(50);

    expect(browser.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(fetchMock).toHaveBeenCalledWith(
      '/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'local-bootstrap-token' }),
      }),
    );
    expect(harness.connectionStarts).toBe(1);

    const options = harness.connectionOptions[0];
    if (options === undefined) {
      throw new Error('Display connection was not created.');
    }
    const view = {
      title: 'Synthetic view',
      html: '<p>Body</p>',
      css: '',
    };
    options.onSnapshot(
      {
        instanceId: '123e4567-e89b-42d3-a456-426614174000',
        revision: 1,
        view,
      },
      'replace',
    );
    options.onSnapshot(
      {
        instanceId: '123e4567-e89b-42d3-a456-426614174000',
        revision: 1,
        view,
      },
      'ignore',
    );
    options.onStatus('connected');
    expect(element(browser, '#connection-status').textContent).toBe(
      'Connected',
    );
    options.onStatus('reconnecting');
    expect(element(browser, '#connection-status').textContent).toBe(
      'Reconnecting',
    );
    options.onStatus('disconnected');
    expect(element(browser, '#connection-status').textContent).toBe(
      'Disconnected',
    );
    options.onStale(true);
    expect(harness.renderCalls).toEqual([view]);
    expect(harness.staleCalls).toEqual([true]);

    options.onTerminalFailure('access');
    expect(element(browser, '#empty-detail').textContent).toContain(
      'Access denied',
    );
    options.onTerminalFailure('response');
    expect(element(browser, '#empty-detail').textContent).toContain(
      'unexpected response',
    );

    browser.listeners.get('window:pagehide')?.();
    expect(harness.connectionStops).toBe(1);
  });

  it('reuses an existing cookie session when no token is supplied', async () => {
    const browser = createBrowserHarness('');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await loadShell();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.connectionStarts).toBe(1);
    expect(element(browser, '#connection-status')).toMatchObject({
      textContent: 'Reconnecting',
      dataset: { state: 'reconnecting' },
    });
    expect(element(browser, '#empty-detail').textContent).toContain(
      'existing local browser session',
    );
  });

  it.each([
    {
      response: () => Promise.resolve(new Response(null, { status: 401 })),
      status: 'Access denied',
      detail: 'fresh Agent Canvas access URL',
    },
    {
      response: () => Promise.resolve(new Response(null, { status: 503 })),
      status: 'Unavailable',
      detail: 'could not be established',
    },
    {
      response: () => Promise.reject(new Error('network failure')),
      status: 'Unavailable',
      detail: 'could not be established',
    },
  ])(
    'surfaces bootstrap failure as $status',
    async ({ response, status, detail }) => {
      const browser = createBrowserHarness('#token=invalid-or-unavailable');
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockReturnValue(response()));

      await loadShell();
      await vi.advanceTimersByTimeAsync(0);

      expect(harness.connectionStarts).toBe(0);
      expect(element(browser, '#connection-status').textContent).toBe(status);
      expect(element(browser, '#empty-detail').textContent).toContain(detail);
      expect(element(browser, '#connection-status').dataset['state']).toBe(
        'disconnected',
      );
    },
  );
});
