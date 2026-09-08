import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DisplaySnapshot } from '../../contracts/display.js';
import {
  createSseConnection,
  formatSnapshotEvent,
  heartbeatEvent,
  type SseConnectionWriter,
} from './sse-connection.js';

const instanceId = '123e4567-e89b-42d3-a456-426614174000';

function snapshot(revision: number): DisplaySnapshot {
  return {
    instanceId,
    revision,
    view:
      revision === 0
        ? null
        : {
            title: `Synthetic ${revision.toString()}`,
            html: `<p>Revision ${revision.toString()}</p>`,
            css: '',
          },
  };
}

class ControlledWriter implements SseConnectionWriter {
  readonly chunks: string[] = [];
  readonly destroy = vi.fn(() => {
    this.emit('close');
  });
  readonly #listeners = new Map<
    'close' | 'drain' | 'error',
    Set<(...arguments_: unknown[]) => void>
  >();
  readonly #writeResults: boolean[];
  throwOnWrite = false;

  constructor(writeResults: boolean[] = []) {
    this.#writeResults = [...writeResults];
  }

  write(chunk: string): boolean {
    if (this.throwOnWrite) {
      throw new Error('controlled writer failure');
    }
    this.chunks.push(chunk);
    return this.#writeResults.shift() ?? true;
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

  listenerCount(event: 'close' | 'drain' | 'error'): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSseConnection', () => {
  it('writes the exact full-snapshot framing before any heartbeat', () => {
    const writer = new ControlledWriter();
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose: vi.fn(),
    });

    expect(writer.chunks).toEqual([
      `event: snapshot\nid: ${instanceId}:0\ndata: {"instanceId":"${instanceId}","revision":0,"view":null}\n\n`,
    ]);
    expect(writer.chunks[0]).toBe(formatSnapshotEvent(snapshot(0)));
    connection.close();
  });

  it('keeps only the latest pending snapshot while backpressured', () => {
    const writer = new ControlledWriter([false, true]);
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose: vi.fn(),
    });

    connection.publish(snapshot(1));
    connection.publish(snapshot(2));
    connection.publish(snapshot(3));
    expect(writer.chunks).toEqual([formatSnapshotEvent(snapshot(0))]);

    writer.emit('drain');
    expect(writer.chunks).toEqual([
      formatSnapshotEvent(snapshot(0)),
      formatSnapshotEvent(snapshot(3)),
    ]);
    connection.close();
  });

  it('isolates a slow writer from a writable observer', () => {
    const slowWriter = new ControlledWriter([false]);
    const healthyWriter = new ControlledWriter();
    const slow = createSseConnection({
      writer: slowWriter,
      initialSnapshot: snapshot(0),
      onClose: vi.fn(),
    });
    const healthy = createSseConnection({
      writer: healthyWriter,
      initialSnapshot: snapshot(0),
      onClose: vi.fn(),
    });

    slow.publish(snapshot(1));
    healthy.publish(snapshot(1));

    expect(slowWriter.chunks).toEqual([formatSnapshotEvent(snapshot(0))]);
    expect(healthyWriter.chunks).toEqual([
      formatSnapshotEvent(snapshot(0)),
      formatSnapshotEvent(snapshot(1)),
    ]);
    slow.close();
    healthy.close();
  });

  it('skips heartbeats during backpressure without building a backlog', () => {
    vi.useFakeTimers();
    const writer = new ControlledWriter([false, true]);
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose: vi.fn(),
      drainTimeoutMs: 20_000,
    });

    vi.advanceTimersByTime(15_000);
    expect(writer.chunks).toEqual([formatSnapshotEvent(snapshot(0))]);

    writer.emit('drain');
    vi.advanceTimersByTime(4_999);
    expect(writer.chunks).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(writer.chunks).toEqual([
      formatSnapshotEvent(snapshot(0)),
      heartbeatEvent,
    ]);
    connection.close();
  });

  it('evicts a writer that stays backpressured for five seconds', () => {
    vi.useFakeTimers();
    const writer = new ControlledWriter([false]);
    const onClose = vi.fn();
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose,
    });

    vi.advanceTimersByTime(4_999);
    expect(connection.closed).toBe(false);
    vi.advanceTimersByTime(1);

    expect(connection.closed).toBe(true);
    expect(writer.destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes safely on write failure without appending diagnostics', () => {
    const writer = new ControlledWriter();
    writer.throwOnWrite = true;
    const onClose = vi.fn();
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose,
    });

    expect(connection.closed).toBe(true);
    expect(writer.chunks).toEqual([]);
    expect(writer.destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cleans timers and listeners exactly once on closure', () => {
    vi.useFakeTimers();
    const writer = new ControlledWriter();
    const onClose = vi.fn();
    const connection = createSseConnection({
      writer,
      initialSnapshot: snapshot(0),
      onClose,
    });

    expect(writer.listenerCount('drain')).toBe(1);
    writer.emit('close');
    connection.close();
    vi.advanceTimersByTime(10_000);

    expect(onClose).toHaveBeenCalledOnce();
    expect(writer.destroy).not.toHaveBeenCalled();
    expect(writer.listenerCount('drain')).toBe(0);
    expect(writer.chunks).toHaveLength(1);
  });
});
