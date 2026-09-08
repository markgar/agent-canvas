import {
  displaySnapshotSchema,
  type DisplaySnapshot,
} from '../../contracts/display.js';

export const MAX_PARTIAL_EVENT_BYTES = 8 * 1024 * 1024;

export class SseProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SseProtocolError';
  }
}

export interface DisplayEventHandlers {
  onSnapshot(snapshot: DisplaySnapshot): void;
  onHeartbeat(): void;
}

interface EventBoundary {
  frameEnd: number;
}

function findEventBoundaryAtEnd(
  bytes: Uint8Array,
  length: number,
): EventBoundary | null {
  let firstLineFeed = -1;
  if (length >= 2 && bytes[length - 2] === 0x0a && bytes[length - 1] === 0x0a) {
    firstLineFeed = length - 2;
  } else if (
    length >= 3 &&
    bytes[length - 3] === 0x0a &&
    bytes[length - 2] === 0x0d &&
    bytes[length - 1] === 0x0a
  ) {
    firstLineFeed = length - 3;
  }

  if (firstLineFeed === -1) {
    return null;
  }
  return {
    frameEnd:
      firstLineFeed > 0 && bytes[firstLineFeed - 1] === 0x0d
        ? firstLineFeed - 1
        : firstLineFeed,
  };
}

function isDelimiterPrefixBeyondLimit(
  bytes: Uint8Array,
  length: number,
): boolean {
  const overflowLength = length - MAX_PARTIAL_EVENT_BYTES;
  if (overflowLength <= 0) {
    return true;
  }

  const prefixes = [
    [0x0a],
    [0x0a, 0x0d],
    [0x0d],
    [0x0d, 0x0a],
    [0x0d, 0x0a, 0x0d],
  ];
  return prefixes.some(
    (prefix) =>
      prefix.length === overflowLength &&
      prefix.every(
        (value, index) => bytes[MAX_PARTIAL_EVENT_BYTES + index] === value,
      ),
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new SseProtocolError('The display stream contained invalid JSON.');
  }
}

export class DisplaySseParser {
  readonly #decoder = new TextDecoder('utf-8', { fatal: true });
  readonly #handlers: DisplayEventHandlers;
  #buffer = new Uint8Array(1024);
  #length = 0;
  #receivedSnapshot = false;

  public constructor(handlers: DisplayEventHandlers) {
    this.#handlers = handlers;
  }

  public push(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.#ensureCapacity(this.#length + 1);
      this.#buffer[this.#length] = byte;
      this.#length += 1;

      const boundary = findEventBoundaryAtEnd(this.#buffer, this.#length);
      if (boundary === null) {
        if (!isDelimiterPrefixBeyondLimit(this.#buffer, this.#length)) {
          this.#failTooLarge();
        }
        continue;
      }
      if (boundary.frameEnd > MAX_PARTIAL_EVENT_BYTES) {
        this.#failTooLarge();
      }

      const frameBytes = this.#buffer.slice(0, boundary.frameEnd);
      this.#length = 0;
      this.#parseFrame(frameBytes);
    }
  }

  #ensureCapacity(required: number): void {
    if (required > MAX_PARTIAL_EVENT_BYTES + 4) {
      this.#failTooLarge();
    }
    if (required <= this.#buffer.byteLength) {
      return;
    }
    const nextCapacity = Math.min(
      MAX_PARTIAL_EVENT_BYTES + 4,
      Math.max(required, this.#buffer.byteLength * 2),
    );
    const next = new Uint8Array(nextCapacity);
    next.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = next;
  }

  #failTooLarge(): never {
    this.#buffer = new Uint8Array(1024);
    this.#length = 0;
    throw new SseProtocolError('The display stream event was too large.');
  }

  #parseFrame(frameBytes: Uint8Array): void {
    let frame: string;
    try {
      frame = this.#decoder.decode(frameBytes);
    } catch {
      throw new SseProtocolError('The display stream contained invalid UTF-8.');
    }

    let eventType = '';
    let eventId: string | null = null;
    const dataLines: string[] = [];
    let hasFields = false;

    for (const rawLine of frame.split(/\r?\n/u)) {
      if (rawLine.startsWith(':')) {
        continue;
      }
      if (rawLine.length === 0) {
        continue;
      }

      hasFields = true;
      const separator = rawLine.indexOf(':');
      const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
      let value = separator === -1 ? '' : rawLine.slice(separator + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }

      switch (field) {
        case 'event':
          eventType = value;
          break;
        case 'id':
          eventId = value;
          break;
        case 'data':
          dataLines.push(value);
          break;
        default:
          break;
      }
    }

    if (!hasFields) {
      return;
    }

    const data = dataLines.join('\n');
    if (eventType === 'heartbeat') {
      if (!this.#receivedSnapshot) {
        throw new SseProtocolError(
          'The display stream sent a heartbeat before its first snapshot.',
        );
      }
      if (eventId !== null || data !== '{}') {
        throw new SseProtocolError(
          'The display stream sent an invalid heartbeat.',
        );
      }
      this.#handlers.onHeartbeat();
      return;
    }

    if (eventType !== 'snapshot') {
      throw new SseProtocolError(
        'The display stream sent an unknown event type.',
      );
    }
    if (eventId === null) {
      throw new SseProtocolError(
        'The display stream snapshot did not include an event ID.',
      );
    }

    const parsed = displaySnapshotSchema.safeParse(parseJson(data));
    if (!parsed.success) {
      throw new SseProtocolError(
        'The display stream sent an invalid snapshot.',
      );
    }

    const expectedId = `${parsed.data.instanceId}:${parsed.data.revision.toString()}`;
    if (eventId !== expectedId) {
      throw new SseProtocolError(
        'The display stream snapshot ID was inconsistent.',
      );
    }

    this.#receivedSnapshot = true;
    this.#handlers.onSnapshot(parsed.data);
  }
}
