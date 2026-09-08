import type { DisplaySnapshot } from '../../contracts/display.js';
import { DisplaySseParser } from './sse-parser.js';

const CONNECTION_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
export type SnapshotAction = 'replace' | 'confirm' | 'ignore';
export type TerminalConnectionFailure = 'access' | 'http';
export type TimerHandle = ReturnType<typeof globalThis.setTimeout> | number;

export interface ConnectionScheduler {
  now(): number;
  setTimeout(callback: () => void, delay: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface VisibilitySource {
  isHidden(): boolean;
  addChangeListener(listener: () => void): void;
  removeChangeListener(listener: () => void): void;
}

export interface DisplayConnectionOptions {
  fetch?: typeof globalThis.fetch;
  scheduler?: ConnectionScheduler;
  visibility?: VisibilitySource;
  onSnapshot: (snapshot: DisplaySnapshot, action: SnapshotAction) => void;
  onStatus: (status: ConnectionStatus) => void;
  onStale: (stale: boolean) => void;
  onTerminalFailure: (failure: TerminalConnectionFailure) => void;
}

interface ActiveAttempt {
  generation: number;
  controller: AbortController;
  timeout: TimerHandle | null;
  timedOut: boolean;
  hasSnapshot: boolean;
}

const defaultScheduler: ConnectionScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export function compareSnapshots(
  current: DisplaySnapshot | null,
  next: DisplaySnapshot,
): SnapshotAction {
  if (current === null || current.instanceId !== next.instanceId) {
    return 'replace';
  }
  if (next.revision > current.revision) {
    return 'replace';
  }
  if (next.revision === current.revision) {
    return 'confirm';
  }
  return 'ignore';
}

export class DisplayConnection {
  readonly #fetch: typeof globalThis.fetch;
  readonly #scheduler: ConnectionScheduler;
  readonly #visibility: VisibilitySource | undefined;
  readonly #onSnapshot: DisplayConnectionOptions['onSnapshot'];
  readonly #onStatus: DisplayConnectionOptions['onStatus'];
  readonly #onStale: DisplayConnectionOptions['onStale'];
  readonly #onTerminalFailure: DisplayConnectionOptions['onTerminalFailure'];
  readonly #visibilityListener = (): void => {
    this.#handleVisibilityChange();
  };

  #activeAttempt: ActiveAttempt | null = null;
  #currentSnapshot: DisplaySnapshot | null = null;
  #generation = 0;
  #lastEvidenceAt: number | null = null;
  #retryTimer: TimerHandle | null = null;
  #statusTimer: TimerHandle | null = null;
  #status: ConnectionStatus | null = null;
  #stale = false;
  #started = false;
  #stopped = false;
  #terminal = false;

  public constructor(options: DisplayConnectionOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#visibility = options.visibility;
    this.#onSnapshot = options.onSnapshot;
    this.#onStatus = options.onStatus;
    this.#onStale = options.onStale;
    this.#onTerminalFailure = options.onTerminalFailure;
  }

  public start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#stopped = false;
    this.#lastEvidenceAt = this.#scheduler.now();
    this.#setStatus('reconnecting');
    this.#armStatusDeadline();
    this.#visibility?.addChangeListener(this.#visibilityListener);
    this.#launchAttempt();
  }

  public reconnectNow(): void {
    if (!this.#started || this.#stopped || this.#terminal) {
      return;
    }
    this.#clearRetryTimer();
    this.#launchAttempt();
  }

  public stop(): void {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#generation += 1;
    this.#activeAttempt?.controller.abort();
    this.#activeAttempt = null;
    this.#clearRetryTimer();
    this.#clearStatusTimer();
    this.#visibility?.removeChangeListener(this.#visibilityListener);
  }

  #launchAttempt(): void {
    this.#activeAttempt?.controller.abort();
    const attempt: ActiveAttempt = {
      generation: ++this.#generation,
      controller: new AbortController(),
      timeout: null,
      timedOut: false,
      hasSnapshot: false,
    };
    this.#activeAttempt = attempt;
    this.#armAttemptTimeout(attempt);
    void this.#runAttempt(attempt);
  }

  async #runAttempt(attempt: ActiveAttempt): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let responseBody: ReadableStream<Uint8Array> | null = null;
    let cancelReader: (() => void) | null = null;

    try {
      const response = await this.#fetch('/events', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'text/event-stream' },
        signal: attempt.controller.signal,
      });
      if (!this.#isCurrent(attempt)) {
        return;
      }
      responseBody = response.body;

      if (response.status === 401 || response.status === 403) {
        void responseBody?.cancel().catch(() => undefined);
        attempt.controller.abort();
        this.#setTerminal('access');
        return;
      }
      if (response.status === 429 || response.status === 503) {
        throw new Error('Retryable display stream response.');
      }
      if (response.status !== 200) {
        void responseBody?.cancel().catch(() => undefined);
        attempt.controller.abort();
        this.#setTerminal('http');
        return;
      }
      if (response.body === null) {
        throw new Error('Display stream response had no body.');
      }

      const parser = new DisplaySseParser({
        onSnapshot: (snapshot) => {
          if (!this.#isCurrent(attempt)) {
            return;
          }
          attempt.hasSnapshot = true;
          this.#armAttemptTimeout(attempt);
          this.#recordEvidence();
          const action = compareSnapshots(this.#currentSnapshot, snapshot);
          if (action === 'replace') {
            this.#currentSnapshot = snapshot;
          }
          this.#onSnapshot(snapshot, action);
        },
        onHeartbeat: () => {
          if (!this.#isCurrent(attempt) || !attempt.hasSnapshot) {
            return;
          }
          this.#armAttemptTimeout(attempt);
          this.#recordEvidence();
        },
      });

      reader = response.body.getReader();
      cancelReader = (): void => {
        void reader?.cancel().catch(() => undefined);
      };
      attempt.controller.signal.addEventListener('abort', cancelReader, {
        once: true,
      });

      while (this.#isCurrent(attempt)) {
        const result = await reader.read();
        if (result.done) {
          throw new Error('Display stream ended.');
        }
        parser.push(result.value);
      }
    } catch {
      if (!this.#isCurrent(attempt)) {
        return;
      }
      if (attempt.controller.signal.aborted && !attempt.timedOut) {
        return;
      }
      if (cancelReader !== null) {
        attempt.controller.signal.removeEventListener('abort', cancelReader);
        cancelReader();
        cancelReader = null;
      } else if (responseBody !== null) {
        void responseBody.cancel().catch(() => undefined);
      }
      attempt.controller.abort();
      this.#handleRetryableFailure();
    } finally {
      if (cancelReader !== null) {
        attempt.controller.signal.removeEventListener('abort', cancelReader);
      }
      reader?.releaseLock();
      if (attempt.timeout !== null) {
        this.#scheduler.clearTimeout(attempt.timeout);
      }
      if (this.#activeAttempt === attempt) {
        this.#activeAttempt = null;
      }
    }
  }

  #isCurrent(attempt: ActiveAttempt): boolean {
    return (
      !this.#stopped &&
      !this.#terminal &&
      this.#activeAttempt === attempt &&
      attempt.generation === this.#generation
    );
  }

  #armAttemptTimeout(attempt: ActiveAttempt): void {
    if (attempt.timeout !== null) {
      this.#scheduler.clearTimeout(attempt.timeout);
    }
    attempt.timeout = this.#scheduler.setTimeout(() => {
      if (!this.#isCurrent(attempt)) {
        return;
      }
      attempt.timedOut = true;
      this.#markStale();
      this.#setStatus('disconnected');
      attempt.controller.abort();
    }, CONNECTION_TIMEOUT_MS);
  }

  #recordEvidence(): void {
    this.#lastEvidenceAt = this.#scheduler.now();
    this.#setStale(false);
    this.#setStatus('connected');
    this.#armStatusDeadline();
  }

  #handleRetryableFailure(): void {
    this.#markStale();
    if (this.#isPastStatusDeadline()) {
      this.#setStatus('disconnected');
    } else {
      this.#setStatus('reconnecting');
    }
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    this.#clearRetryTimer();
    this.#retryTimer = this.#scheduler.setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#stopped && !this.#terminal) {
        this.#launchAttempt();
      }
    }, RETRY_DELAY_MS);
  }

  #setTerminal(failure: TerminalConnectionFailure): void {
    this.#terminal = true;
    this.#clearRetryTimer();
    this.#clearStatusTimer();
    this.#markStale();
    this.#setStatus('disconnected');
    this.#onTerminalFailure(failure);
  }

  #armStatusDeadline(): void {
    this.#clearStatusTimer();
    const evidenceAt = this.#lastEvidenceAt;
    if (evidenceAt === null) {
      return;
    }
    const remaining = Math.max(
      0,
      CONNECTION_TIMEOUT_MS - (this.#scheduler.now() - evidenceAt),
    );
    this.#statusTimer = this.#scheduler.setTimeout(() => {
      this.#statusTimer = null;
      if (this.#terminal || this.#stopped) {
        return;
      }
      if (!this.#isPastStatusDeadline()) {
        this.#armStatusDeadline();
        return;
      }
      this.#markStale();
      this.#setStatus('disconnected');
    }, remaining);
  }

  #isPastStatusDeadline(): boolean {
    return (
      this.#lastEvidenceAt !== null &&
      this.#scheduler.now() - this.#lastEvidenceAt >= CONNECTION_TIMEOUT_MS
    );
  }

  #handleVisibilityChange(): void {
    if (
      this.#visibility?.isHidden() !== false ||
      this.#terminal ||
      this.#stopped ||
      !this.#isPastStatusDeadline()
    ) {
      return;
    }
    this.#markStale();
    this.#setStatus('disconnected');
    this.reconnectNow();
  }

  #markStale(): void {
    this.#setStale(true);
  }

  #setStale(stale: boolean): void {
    if (this.#stale === stale) {
      return;
    }
    this.#stale = stale;
    this.#onStale(stale);
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) {
      return;
    }
    this.#status = status;
    this.#onStatus(status);
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== null) {
      this.#scheduler.clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #clearStatusTimer(): void {
    if (this.#statusTimer !== null) {
      this.#scheduler.clearTimeout(this.#statusTimer);
      this.#statusTimer = null;
    }
  }
}
