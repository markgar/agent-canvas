import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

type ProcessExit = [number | null, NodeJS.Signals | null];

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

export class CanvasBrowser {
  readonly context: BrowserContext;
  readonly #profilePath: string;
  #closed = false;

  private constructor(context: BrowserContext, profilePath: string) {
    this.context = context;
    this.#profilePath = profilePath;
  }

  static async start(): Promise<CanvasBrowser> {
    const profilePath = await mkdtemp(join(tmpdir(), 'agent-canvas-browser-'));
    try {
      const context = await chromium.launchPersistentContext(profilePath, {
        headless: true,
      });
      await Promise.all(context.pages().map((page) => page.close()));
      return new CanvasBrowser(context, profilePath);
    } catch (error) {
      await rm(profilePath, { recursive: true, force: true });
      throw error;
    }
  }

  newPage(): Promise<Page> {
    return this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      await this.context.close();
    } finally {
      await rm(this.#profilePath, { recursive: true, force: true });
    }
  }
}

export class CanvasChildProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #exit: Promise<ProcessExit>;
  #stdout = '';
  #stderr = '';

  private constructor(port: number | string) {
    this.#child = spawn(process.execPath, [entryPoint], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_CANVAS_PORT: String(port),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

  signal(signal: NodeJS.Signals): void {
    this.#child.kill(signal);
  }

  waitForExit(): Promise<ProcessExit> {
    return this.#exit;
  }

  async close(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL');
    }
    await this.#exit;
  }
}

export class CanvasMcpProcess {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  readonly protocolErrors: string[] = [];
  #stderr = '';

  private constructor(port: number) {
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
    const process = new CanvasMcpProcess(port);
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

  close(): Promise<void> {
    return this.client.close();
  }
}
