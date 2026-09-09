import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, type BrowserContext, type Page } from 'playwright';

import {
  mutationResultSchema,
  statusResultSchema,
  type CanvasPresentInput,
  type MutationResult,
  type StatusResult,
} from '../../src/contracts/display.js';

const entryPoint = fileURLToPath(
  new URL('../../dist/server/main.js', import.meta.url),
);
const resourceScope = createHash('sha256')
  .update(process.cwd())
  .digest('hex')
  .slice(0, 16);
const resourceDirectory = join(
  tmpdir(),
  `agent-canvas-acceptance-${resourceScope}`,
);
const sharedResourceDirectory = join(resourceDirectory, 'shared');
const exclusiveResourcePath = join(resourceDirectory, 'exclusive');
const resourceOwner = `${process.pid.toString()}-${randomUUID()}`;
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));
const EXCLUSIVE_QUIET_PERIOD_MS = 10_000;
const STALE_UNOWNED_LOCK_MS = 120_000;
let sharedLeaseSequence = 0;
let exclusiveLeaseHeld = false;

type ProcessExit = [number | null, NodeJS.Signals | null];
type ResourceRelease = () => void;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitSynchronously(milliseconds: number): void {
  Atomics.wait(lockWaitBuffer, 0, 0, milliseconds);
}

function initializeResourceDirectory(): void {
  mkdirSync(sharedResourceDirectory, { recursive: true });
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ownerPid(owner: string): number | undefined {
  const [value] = owner.split('-', 1);
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function removeStaleExclusiveLease(): void {
  if (!existsSync(exclusiveResourcePath)) {
    return;
  }
  let owner = '';
  try {
    owner = readFileSync(exclusiveResourcePath, 'utf8');
  } catch {
    return;
  }
  const pid = ownerPid(owner);
  if (pid !== undefined && processIsRunning(pid)) {
    return;
  }
  if (pid === undefined) {
    try {
      if (
        Date.now() - statSync(exclusiveResourcePath).mtimeMs <
        STALE_UNOWNED_LOCK_MS
      ) {
        return;
      }
    } catch {
      return;
    }
  }
  try {
    unlinkSync(exclusiveResourcePath);
  } catch {
    // Another worker may already have removed the stale lease.
  }
}

function activeSharedLeases(): string[] {
  initializeResourceDirectory();
  const active: string[] = [];
  for (const name of readdirSync(sharedResourceDirectory)) {
    const path = join(sharedResourceDirectory, name);
    let owner = '';
    try {
      owner = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const pid = ownerPid(owner);
    if (pid !== undefined && processIsRunning(pid)) {
      active.push(name);
      continue;
    }
    try {
      unlinkSync(path);
    } catch {
      // Another worker may already have removed the stale lease.
    }
  }
  return active;
}

function releaseSharedLease(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

function acquireSharedResourceLease(): ResourceRelease {
  if (exclusiveLeaseHeld) {
    return () => undefined;
  }
  initializeResourceDirectory();
  const leasePath = join(
    sharedResourceDirectory,
    `${resourceOwner}-${(sharedLeaseSequence += 1).toString()}`,
  );

  for (;;) {
    removeStaleExclusiveLease();
    if (existsSync(exclusiveResourcePath)) {
      waitSynchronously(25);
      continue;
    }
    try {
      writeFileSync(leasePath, resourceOwner, { flag: 'wx' });
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        continue;
      }
      throw error;
    }
    if (!existsSync(exclusiveResourcePath)) {
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        releaseSharedLease(leasePath);
      };
    }
    releaseSharedLease(leasePath);
    waitSynchronously(25);
  }
}

async function acquireExclusiveResourceLease(): Promise<ResourceRelease> {
  initializeResourceDirectory();
  let quietSince: number | undefined;

  for (;;) {
    removeStaleExclusiveLease();
    if (existsSync(exclusiveResourcePath) || activeSharedLeases().length > 0) {
      quietSince = undefined;
      await sleep(25);
      continue;
    }
    quietSince ??= performance.now();
    if (performance.now() - quietSince < EXCLUSIVE_QUIET_PERIOD_MS) {
      await sleep(25);
      continue;
    }

    try {
      writeFileSync(exclusiveResourcePath, resourceOwner, { flag: 'wx' });
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        quietSince = undefined;
        await sleep(25);
        continue;
      }
      throw error;
    }
    if (activeSharedLeases().length > 0) {
      unlinkSync(exclusiveResourcePath);
      quietSince = undefined;
      await sleep(25);
      continue;
    }

    exclusiveLeaseHeld = true;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      exclusiveLeaseHeld = false;
      if (
        existsSync(exclusiveResourcePath) &&
        readFileSync(exclusiveResourcePath, 'utf8') === resourceOwner
      ) {
        unlinkSync(exclusiveResourcePath);
      }
    };
  }
}

export function verifyExclusiveCanvasResources(): {
  exclusive: true;
  competingResources: 0;
} {
  if (
    !exclusiveLeaseHeld ||
    !existsSync(exclusiveResourcePath) ||
    readFileSync(exclusiveResourcePath, 'utf8') !== resourceOwner
  ) {
    throw new Error('The exclusive Canvas test resource lease is not held.');
  }
  const competingResources = activeSharedLeases().length;
  if (competingResources !== 0) {
    throw new Error('Competing Canvas test resources are active.');
  }
  return { exclusive: true, competingResources: 0 };
}

export async function withExclusiveCanvasResources<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const release = await acquireExclusiveResourceLease();
  try {
    return await callback();
  } finally {
    release();
  }
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function listeningAddress(stderr: string): string | undefined {
  return /^Agent Canvas listening at (http:\/\/127\.0\.0\.1:\d+)$/m.exec(
    stderr,
  )?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuredContent(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result['structuredContent'])) {
    throw new Error('Expected structured tool content.');
  }
  return result['structuredContent'];
}

export async function closeCanvasResources(
  resources: Array<{ close(): Promise<void> }>,
): Promise<void> {
  const results = await Promise.allSettled(
    resources.map((resource) => resource.close()),
  );
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('Agent Canvas test resource cleanup failed.');
  }
}

export interface CanvasEnvironmentMetadata {
  runtime: string;
  os: string;
  architecture: string;
  machine: string;
  browser: string;
}

export async function openAuthenticatedCanvas(
  page: Page,
  url: string,
): Promise<void> {
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

export async function observeFrameTextAfterAnimationFrame(
  page: Page,
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const body = page
    .frameLocator('iframe.content-frame')
    .locator('body')
    .filter({ hasText: expected });
  await body.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
}

export class CanvasBrowser {
  readonly context: BrowserContext;
  readonly #profilePath: string;
  readonly #releaseResource: ResourceRelease;
  #closed = false;

  private constructor(
    context: BrowserContext,
    profilePath: string,
    releaseResource: ResourceRelease,
  ) {
    this.context = context;
    this.#profilePath = profilePath;
    this.#releaseResource = releaseResource;
  }

  static async start(): Promise<CanvasBrowser> {
    const releaseResource = acquireSharedResourceLease();
    const profilePath = await mkdtemp(join(tmpdir(), 'agent-canvas-browser-'));
    try {
      const context = await chromium.launchPersistentContext(profilePath, {
        headless: true,
      });
      await Promise.all(context.pages().map((page) => page.close()));
      return new CanvasBrowser(context, profilePath, releaseResource);
    } catch (error) {
      await rm(profilePath, { recursive: true, force: true });
      releaseResource();
      throw error;
    }
  }

  newPage(): Promise<Page> {
    return this.context.newPage();
  }

  async environmentMetadata(page: Page): Promise<CanvasEnvironmentMetadata> {
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return {
      runtime: process.version,
      os: `${platform()} ${release()}`,
      architecture: arch(),
      machine: cpus()[0]?.model ?? 'unknown',
      browser: this.context.browser()?.version() ?? userAgent,
    };
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      await this.context.close();
    } finally {
      try {
        await rm(this.#profilePath, { recursive: true, force: true });
      } finally {
        this.#releaseResource();
      }
    }
  }
}

export class CanvasChildProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exit: Promise<ProcessExit>;
  readonly #releaseResource: ResourceRelease;
  #stdout = '';
  #stderr = '';
  #closed = false;

  private constructor(port: number | string) {
    this.#releaseResource = acquireSharedResourceLease();
    try {
      this.#child = spawn(process.execPath, [entryPoint], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AGENT_CANVAS_PORT: String(port),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.#releaseResource();
      throw error;
    }
    this.#child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      this.#stdout += chunk;
    });
    this.#child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#exit = new Promise((resolve) => {
      this.#child.once('close', (code, signal) => {
        resolve([code, signal]);
      });
    });
  }

  static spawn(port: number | string = 0): CanvasChildProcess {
    return new CanvasChildProcess(port);
  }

  get stdout(): string {
    return this.#stdout;
  }

  get stderr(): string {
    return this.#stderr;
  }

  async waitForAddress(): Promise<string> {
    await waitFor(
      () => listeningAddress(this.#stderr) !== undefined,
      'Agent Canvas did not report a listening address.',
    );
    const address = listeningAddress(this.#stderr);
    if (address === undefined) {
      throw new Error('Agent Canvas listening address was unavailable.');
    }
    return address;
  }

  endInput(): void {
    this.#child.stdin.end();
  }

  writeInput(value: string): void {
    this.#child.stdin.write(value);
  }

  signal(signal: NodeJS.Signals): void {
    this.#child.kill(signal);
  }

  waitForExit(): Promise<ProcessExit> {
    return this.#exit;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL');
    }
    try {
      await this.#exit;
    } finally {
      this.#releaseResource();
    }
  }
}

export class CanvasMcpProcess {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly protocolErrors: string[] = [];
  readonly #releaseResource: ResourceRelease;
  #stderr = '';
  #closed = false;
  #suspended = false;

  private constructor(port: number, releaseResource: ResourceRelease) {
    this.#releaseResource = releaseResource;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [entryPoint],
      cwd: process.cwd(),
      env: { AGENT_CANVAS_PORT: port.toString() },
      stderr: 'pipe',
    });
    const stderr = this.transport.stderr as Readable;
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
    this.client = new Client({
      name: 'agent-canvas-integration-test',
      version: '1.0.0',
    });
    this.client.onerror = (error) => {
      this.protocolErrors.push(error.message);
    };
  }

  static async start(port = 0): Promise<CanvasMcpProcess> {
    const releaseResource = acquireSharedResourceLease();
    const process = new CanvasMcpProcess(port, releaseResource);
    try {
      await process.client.connect(process.transport);
      await process.address();
      return process;
    } catch (error) {
      await process.close();
      throw error;
    }
  }

  get stderr(): string {
    return this.#stderr;
  }

  async address(): Promise<string> {
    await waitFor(
      () => listeningAddress(this.#stderr) !== undefined,
      'Agent Canvas did not report a listening address.',
    );
    const address = listeningAddress(this.#stderr);
    if (address === undefined) {
      throw new Error('Agent Canvas listening address was unavailable.');
    }
    return address;
  }

  async getStatus(): Promise<StatusResult> {
    const result = await this.client.callTool({
      name: 'canvas_get_status',
      arguments: {},
    });
    return statusResultSchema.parse(structuredContent(result));
  }

  async present(input: CanvasPresentInput): Promise<MutationResult> {
    const result = await this.client.callTool({
      name: 'canvas_present',
      arguments: input,
    });
    return mutationResultSchema.parse(structuredContent(result));
  }

  async clear(): Promise<MutationResult> {
    const result = await this.client.callTool({
      name: 'canvas_clear',
      arguments: {},
    });
    return mutationResultSchema.parse(structuredContent(result));
  }

  async waitForStreamCount(expected: number, timeoutMs = 5_000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if ((await this.getStatus()).connectedBrowsers === expected) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for the browser stream count.');
  }

  suspend(): void {
    const pid = this.transport.pid;
    if (pid === null) {
      throw new Error('Agent Canvas process is unavailable.');
    }
    if (pid === process.pid) {
      throw new Error('Refusing to suspend the test runner.');
    }
    process.kill(pid, 'SIGSTOP');
    this.#suspended = true;
  }

  resume(): void {
    if (!this.#suspended) {
      return;
    }
    const pid = this.transport.pid;
    if (pid === null) {
      throw new Error('Agent Canvas process is unavailable.');
    }
    process.kill(pid, 'SIGCONT');
    this.#suspended = false;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.resume();
    try {
      await this.client.close();
    } finally {
      this.#releaseResource();
    }
  }
}
