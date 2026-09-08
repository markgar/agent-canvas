import type { DisplaySnapshot } from '../../contracts/display.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SseConnectionWriter {
  write(chunk: string): boolean;
  destroy(): void;
  on(
    event: 'close' | 'drain' | 'error',
    listener: (...arguments_: unknown[]) => void,
  ): void;
  off(
    event: 'close' | 'drain' | 'error',
    listener: (...arguments_: unknown[]) => void,
  ): void;
}

export interface SseConnectionOptions {
  writer: SseConnectionWriter;
  initialSnapshot: DisplaySnapshot;
  onClose: () => void;
  heartbeatIntervalMs?: number;
  drainTimeoutMs?: number;
}

export interface SseConnection {
  publish(snapshot: DisplaySnapshot): void;
  close(): void;
  readonly closed: boolean;
}

export function formatSnapshotEvent(snapshot: DisplaySnapshot): string {
  return `event: snapshot\nid: ${snapshot.instanceId}:${snapshot.revision.toString()}\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

export const heartbeatEvent = 'event: heartbeat\ndata: {}\n\n';

export function createSseConnection(
  options: SseConnectionOptions,
): SseConnection {
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  let backpressured = false;
  let closed = false;
  let pendingSnapshot: DisplaySnapshot | undefined;
  let drainTimer: TimerHandle | undefined;
  let heartbeatTimer: TimerHandle | undefined;

  const clearDrainTimer = (): void => {
    if (drainTimer !== undefined) {
      clearTimeout(drainTimer);
      drainTimer = undefined;
    }
  };

  const finish = (destroyWriter: boolean): void => {
    if (closed) {
      return;
    }
    closed = true;
    pendingSnapshot = undefined;
    clearDrainTimer();
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    options.writer.off('drain', handleDrain);
    options.writer.off('close', handleWriterClose);
    options.writer.off('error', handleWriterError);
    if (destroyWriter) {
      try {
        options.writer.destroy();
      } catch {
        // Cleanup still completes when the transport is already unusable.
      }
    }
    options.onClose();
  };

  const armDrainTimeout = (): void => {
    clearDrainTimer();
    drainTimer = setTimeout(() => {
      finish(true);
    }, drainTimeoutMs);
  };

  const write = (event: string): void => {
    if (closed) {
      return;
    }
    try {
      if (!options.writer.write(event)) {
        backpressured = true;
        armDrainTimeout();
      }
    } catch {
      finish(true);
    }
  };

  function handleDrain(): void {
    if (closed || !backpressured) {
      return;
    }
    backpressured = false;
    clearDrainTimer();
    const nextSnapshot = pendingSnapshot;
    pendingSnapshot = undefined;
    if (nextSnapshot !== undefined) {
      write(formatSnapshotEvent(nextSnapshot));
    }
  }

  function handleWriterClose(): void {
    finish(false);
  }

  function handleWriterError(): void {
    finish(true);
  }

  options.writer.on('drain', handleDrain);
  options.writer.on('close', handleWriterClose);
  options.writer.on('error', handleWriterError);

  heartbeatTimer = setInterval(() => {
    if (!backpressured) {
      write(heartbeatEvent);
    }
  }, heartbeatIntervalMs);
  write(formatSnapshotEvent(options.initialSnapshot));

  return {
    publish(snapshot) {
      if (closed) {
        return;
      }
      if (backpressured) {
        pendingSnapshot = snapshot;
        return;
      }
      write(formatSnapshotEvent(snapshot));
    },
    close() {
      finish(true);
    },
    get closed() {
      return closed;
    },
  };
}
