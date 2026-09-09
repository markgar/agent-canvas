import { describe, expect, it, vi } from 'vitest';

import type { DisplaySnapshot } from '../../contracts/display.js';
import {
  compareSnapshots,
  DisplayConnection,
  type ConnectionScheduler,
  type TimerHandle,
  type VisibilitySource,
} from './connection.js';

const INSTANCE_A = '123e4567-e89b-42d3-a456-426614174000';
const INSTANCE_B = '223e4567-e89b-42d3-a456-426614174000';

function snapshot(
  revision: number,
  instanceId = INSTANCE_A,
  hasView = true,
): DisplaySnapshot {
  return {
    instanceId,
    revision,
    view: hasView
      ? { title: `View ${revision.toString()}`, html: '<p>Safe</p>', css: '' }
      : null,
  };
}

function event(value: DisplaySnapshot): Uint8Array {
  return new TextEncoder().encode(
    `event: snapshot\nid: ${value.instanceId}:${value.revision.toString()}\ndata: ${JSON.stringify(value)}\n\n`,
  );
}

function controlledResponse(
  onCancel?: () => void,
  status = 200,
): {
  response: Response;
  send(value: Uint8Array): void;
} {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        onCancel?.();
      },
    }),
    { status },
  );
  return {
    response,
    send: (value) => {
      streamController?.enqueue(value);
    },
  };
}

function closedResponse(value: Uint8Array): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(value);
        controller.close();
      },
    }),
    { status: 200 },
  );
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

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('compareSnapshots', () => {
  it('replaces newer and new-instance snapshots while confirming duplicates and ignoring older revisions', () => {
    expect(compareSnapshots(null, snapshot(4))).toBe('replace');
    expect(compareSnapshots(snapshot(4), snapshot(5))).toBe('replace');
    expect(compareSnapshots(snapshot(4), snapshot(4))).toBe('confirm');
    expect(compareSnapshots(snapshot(4), snapshot(3))).toBe('ignore');
    expect(compareSnapshots(snapshot(99), snapshot(0, INSTANCE_B))).toBe(
      'replace',
    );
  });
});

describe('DisplayConnection', () => {
  it('connects only after a valid snapshot and applies revision rules without repainting duplicates', async () => {
    const stream = controlledResponse();
    const statuses: string[] = [];
    const snapshots: string[] = [];
    const connection = new DisplayConnection({
      fetch: vi.fn().mockResolvedValue(stream.response),
      onSnapshot: (value, action) => {
        snapshots.push(
          `${value.instanceId}:${value.revision.toString()}:${action}`,
        );
      },
      onStatus: (status) => statuses.push(status),
      onStale: vi.fn(),
      onTerminalFailure: vi.fn(),
    });

    connection.start();
    await settle();
    expect(statuses).toEqual(['reconnecting']);

    stream.send(event(snapshot(4)));
    stream.send(event(snapshot(4)));
    stream.send(event(snapshot(3)));
    stream.send(event(snapshot(0, INSTANCE_B, false)));
    await settle();

    expect(statuses).toEqual(['reconnecting', 'connected']);
    expect(snapshots).toEqual([
      `${INSTANCE_A}:4:replace`,
      `${INSTANCE_A}:4:confirm`,
      `${INSTANCE_A}:3:ignore`,
      `${INSTANCE_B}:0:replace`,
    ]);
    connection.stop();
  });

  it('retries 429 and 503 after one second but stops on access and other HTTP failures', async () => {
    vi.useFakeTimers();
    const stream = controlledResponse();
    const cancel429 = vi.fn();
    const cancel503 = vi.fn();
    const retryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(controlledResponse(cancel429, 429).response)
      .mockResolvedValueOnce(controlledResponse(cancel503, 503).response)
      .mockResolvedValueOnce(stream.response);
    const retryConnection = new DisplayConnection({
      fetch: retryFetch,
      scheduler: scheduler(),
      onSnapshot: vi.fn(),
      onStatus: vi.fn(),
      onStale: vi.fn(),
      onTerminalFailure: vi.fn(),
    });

    retryConnection.start();
    await settle();
    expect(retryFetch).toHaveBeenCalledTimes(1);
    expect(cancel429).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retryFetch).toHaveBeenCalledTimes(2);
    expect(cancel503).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retryFetch).toHaveBeenCalledTimes(3);
    retryConnection.stop();

    for (const status of [401, 403, 404, 500]) {
      const terminal = vi.fn();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const connection = new DisplayConnection({
        fetch: fetchMock,
        scheduler: scheduler(),
        onSnapshot: vi.fn(),
        onStatus: vi.fn(),
        onStale: vi.fn(),
        onTerminalFailure: terminal,
      });
      connection.start();
      await settle();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(terminal).toHaveBeenCalledWith(
        status === 401 || status === 403 ? 'access' : 'http',
      );
      connection.stop();
    }
    vi.useRealTimers();
  });

  it('keeps the original status deadline across failed retries', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('down'));
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
    await vi.advanceTimersByTimeAsync(14_999);
    expect(statuses.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(statuses.at(-1)).toBe('disconnected');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);

    connection.stop();
    vi.useRealTimers();
  });

  it('retries EOF and protocol failures without applying an invalid event', async () => {
    vi.useFakeTimers();
    const stream = controlledResponse();
    const canceled = vi.fn();
    const malformed = controlledResponse(canceled);
    const received = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(malformed.response)
      .mockResolvedValueOnce(closedResponse(event(snapshot(1))))
      .mockResolvedValueOnce(stream.response);
    const connection = new DisplayConnection({
      fetch: fetchMock,
      scheduler: scheduler(),
      onSnapshot: received,
      onStatus: vi.fn(),
      onStale: vi.fn(),
      onTerminalFailure: vi.fn(),
    });

    connection.start();
    await settle();
    malformed.send(new TextEncoder().encode('event: unknown\ndata: {}\n\n'));
    await settle();
    expect(received).not.toHaveBeenCalled();
    expect(canceled).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(received).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    connection.stop();
    vi.useRealTimers();
  });

  it('aborts an attempt without a first snapshot after 15 seconds and keeps retrying', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(controlledResponse().response);
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
    await vi.advanceTimersByTimeAsync(15_000);
    expect(statuses.at(-1)).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    connection.stop();
    vi.useRealTimers();
  });

  it('cancels superseded attempts and ignores late callbacks from the old fetch', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const oldStream = controlledResponse();
    const currentStream = controlledResponse();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(currentStream.response);
    const received: string[] = [];
    const connection = new DisplayConnection({
      fetch: fetchMock,
      onSnapshot: (value) => received.push(value.instanceId),
      onStatus: vi.fn(),
      onStale: vi.fn(),
      onTerminalFailure: vi.fn(),
    });

    connection.start();
    connection.reconnectNow();
    await settle();
    currentStream.send(event(snapshot(1, INSTANCE_B)));
    resolveFirst?.(oldStream.response);
    oldStream.send(event(snapshot(9, INSTANCE_A)));
    await settle();

    expect(received).toEqual([INSTANCE_B]);
    connection.stop();
  });

  it('marks silent foreground content stale and immediately supersedes the stream', async () => {
    let now = 0;
    let visibilityListener: (() => void) | undefined;
    const visibility: VisibilitySource = {
      isHidden: () => false,
      addChangeListener: (listener) => {
        visibilityListener = listener;
      },
      removeChangeListener: vi.fn(),
    };
    const timers = new Map<TimerHandle, () => void>();
    let nextTimer = 1;
    const manualScheduler: ConnectionScheduler = {
      now: () => now,
      setTimeout: (callback) => {
        const id = nextTimer++;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(controlledResponse().response);
    const statuses: string[] = [];
    const stale = vi.fn();
    const connection = new DisplayConnection({
      fetch: fetchMock,
      scheduler: manualScheduler,
      visibility,
      onSnapshot: vi.fn(),
      onStatus: (status) => statuses.push(status),
      onStale: stale,
      onTerminalFailure: vi.fn(),
    });

    connection.start();
    await settle();
    now = 15_000;
    visibilityListener?.();
    await settle();

    expect(statuses.at(-1)).toBe('disconnected');
    expect(stale).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    connection.stop();
  });
});
