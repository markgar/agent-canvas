import {
  createHash,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';

const SECRET_BYTES = 32;
const DEFAULT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_LIMIT = 32;
const MAX_RANDOM_ATTEMPTS = 8;

export type RandomBytes = (size: number) => Uint8Array;

export interface BrowserSessionsOptions {
  randomBytes?: RandomBytes;
  now?: () => number;
  idleTimeoutMs?: number;
  sessionLimit?: number;
}

interface SessionRecord {
  digest: Buffer;
  lastActivity: number;
  activeStreams: number;
}

export type BootstrapResult =
  | { status: 'unauthorized' }
  | { status: 'limit' }
  | { status: 'reused' }
  | { status: 'created'; setCookie: string };

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(candidate: string, expectedDigest: Buffer): boolean {
  return timingSafeEqual(digest(candidate), expectedDigest);
}

function encodeSecret(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function sessionCookieName(port: number): string {
  return `agent_canvas_session_${port.toString()}`;
}

function readCookie(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }

  let value: string | undefined;
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0 || segment.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    if (value !== undefined) {
      return undefined;
    }
    value = segment.slice(separator + 1).trim();
  }
  return value;
}

export class BrowserSessions {
  readonly #bootstrapToken: string;
  readonly #bootstrapDigest: Buffer;
  readonly #randomBytes: RandomBytes;
  readonly #now: () => number;
  readonly #idleTimeoutMs: number;
  readonly #sessionLimit: number;
  readonly #records: SessionRecord[] = [];

  constructor(options: BrowserSessionsOptions = {}) {
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.#now = options.now ?? performance.now.bind(performance);
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.#sessionLimit = options.sessionLimit ?? DEFAULT_SESSION_LIMIT;

    const bootstrapSecret = this.#generateSecret();
    this.#bootstrapToken = bootstrapSecret;
    this.#bootstrapDigest = digest(bootstrapSecret);
  }

  get bootstrapToken(): string {
    return this.#bootstrapToken;
  }

  accessUrl(port: number): string {
    return `http://127.0.0.1:${port.toString()}/#token=${this.#bootstrapToken}`;
  }

  cookieName(port: number): string {
    return sessionCookieName(port);
  }

  bootstrap(
    token: string,
    cookieHeader: string | undefined,
    port: number,
  ): BootstrapResult {
    this.pruneExpired();
    if (!safeEqual(token, this.#bootstrapDigest)) {
      return { status: 'unauthorized' };
    }

    const existing = this.#findRecord(cookieHeader, port);
    if (existing !== undefined) {
      existing.lastActivity = this.#now();
      return { status: 'reused' };
    }

    if (this.#records.length >= this.#sessionLimit) {
      return { status: 'limit' };
    }

    const value = this.#createSessionValue();
    this.#records.push({
      digest: digest(value),
      lastActivity: this.#now(),
      activeStreams: 0,
    });
    return {
      status: 'created',
      setCookie: `${sessionCookieName(port)}=${value}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }

  authenticate(cookieHeader: string | undefined, port: number): boolean {
    this.pruneExpired();
    const record = this.#findRecord(cookieHeader, port);
    if (record === undefined) {
      return false;
    }
    record.lastActivity = this.#now();
    return true;
  }

  openStream(
    cookieHeader: string | undefined,
    port: number,
  ): (() => void) | undefined {
    this.pruneExpired();
    const record = this.#findRecord(cookieHeader, port);
    if (record === undefined) {
      return undefined;
    }

    record.lastActivity = this.#now();
    record.activeStreams += 1;
    let closed = false;
    return () => {
      if (closed) {
        return;
      }
      closed = true;
      record.activeStreams -= 1;
      if (record.activeStreams === 0) {
        record.lastActivity = this.#now();
      }
    };
  }

  pruneExpired(): void {
    const now = this.#now();
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (
        record !== undefined &&
        record.activeStreams === 0 &&
        now - record.lastActivity >= this.#idleTimeoutMs
      ) {
        this.#records.splice(index, 1);
      }
    }
  }

  get sessionCount(): number {
    return this.#records.length;
  }

  get activeStreamCount(): number {
    return this.#records.reduce(
      (count, record) => count + record.activeStreams,
      0,
    );
  }

  #findRecord(
    cookieHeader: string | undefined,
    port: number,
  ): SessionRecord | undefined {
    const value = readCookie(cookieHeader, sessionCookieName(port));
    if (value === undefined) {
      return undefined;
    }
    return this.#records.find((record) => safeEqual(value, record.digest));
  }

  #createSessionValue(): string {
    for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
      const value = this.#generateSecret();
      if (!this.#records.some((record) => safeEqual(value, record.digest))) {
        return value;
      }
    }
    throw new Error('Unable to allocate a unique browser session.');
  }

  #generateSecret(): string {
    const bytes = this.#randomBytes(SECRET_BYTES);
    if (bytes.byteLength !== SECRET_BYTES) {
      throw new Error('Random source returned an invalid secret length.');
    }
    return encodeSecret(bytes);
  }
}

export function createBrowserSessions(
  options?: BrowserSessionsOptions,
): BrowserSessions {
  return new BrowserSessions(options);
}
