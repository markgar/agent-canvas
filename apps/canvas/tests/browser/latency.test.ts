import { describe, expect, it } from 'vitest';

import type { CanvasPresentInput } from '../../src/contracts/display.js';
import {
  CanvasBrowser,
  CanvasMcpProcess,
  closeCanvasResources,
  observeFrameTextAfterAnimationFrame,
  openAuthenticatedCanvas,
  verifyExclusiveCanvasResources,
  withExclusiveCanvasResources,
} from '../helpers/canvas-process.js';

const SAMPLE_COUNT = 100;
const MAX_LATENCY_MS = 1_000;
const CSS =
  '.latency-view { display: flex; flex-direction: column; gap: 0.75rem; }' +
  '.latency-table { border-collapse: collapse; }' +
  '.latency-table th, .latency-table td { border: 1px solid #d0d7de; padding: 0.25rem; }' +
  '.latency-copy { display: flex; flex-wrap: wrap; gap: 0.25rem; }' +
  '.latency-row { margin: 0; max-width: 42rem; }';

interface LatencyFailure {
  sample: number;
  milliseconds: number;
}

function exactPayload(
  rawBytes: number,
  sizeLabel: string,
  sample: number,
): { input: CanvasPresentInput; marker: string } {
  const marker = `LATENCY-${sizeLabel}-${sample.toString().padStart(3, '0')}`;
  const prefix =
    `<main class="latency-view"><h1>${marker}</h1>` +
    '<table class="latency-table"><caption>Synthetic timing evidence</caption>' +
    '<thead><tr><th>Category</th><th>Value</th></tr></thead>' +
    '<tbody><tr><td>Source</td><td>Generated local fixture</td></tr>' +
    '<tr><td>Purpose</td><td>Foreground rendering measurement</td></tr></tbody></table>' +
    '<section class="latency-copy">';
  const suffix = '</section></main>';
  const row =
    '<p class="latency-row">Synthetic text and layout evidence for a local foreground display update.</p>';
  let html = prefix;
  const cssBytes = Buffer.byteLength(CSS);

  while (
    Buffer.byteLength(html) +
      Buffer.byteLength(row) +
      Buffer.byteLength(suffix) +
      cssBytes <=
    rawBytes
  ) {
    html += row;
  }

  const remaining =
    rawBytes - Buffer.byteLength(html) - Buffer.byteLength(suffix) - cssBytes;
  html += 'x'.repeat(remaining);
  html += suffix;

  expect(Buffer.byteLength(html) + cssBytes).toBe(rawBytes);
  return {
    input: {
      title: `Foreground latency ${sizeLabel}`,
      html,
      css: CSS,
    },
    marker,
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

describe('compiled foreground rendering latency', () => {
  it('renders 100 sequential exact-size updates per payload within one second after acceptance', async () => {
    await withExclusiveCanvasResources(async () => {
      const process = await CanvasMcpProcess.start();
      const browser = await CanvasBrowser.start();
      try {
        const page = await browser.newPage();
        const status = await process.getStatus();
        await openAuthenticatedCanvas(page, status.browserUrl);
        await page.bringToFront();

        const warm = exactPayload(10 * 1024, '10K-WARM', 0);
        await process.present(warm.input);
        await observeFrameTextAfterAnimationFrame(page, warm.marker);
        await process.waitForStreamCount(1);

        const isolation = verifyExclusiveCanvasResources();
        const metadata = await browser.environmentMetadata(page);
        for (const [rawBytes, sizeLabel] of [
          [10 * 1024, '10K'],
          [512 * 1024, '512K'],
        ] as const) {
          const samples: number[] = [];
          const failures: LatencyFailure[] = [];

          for (let sample = 1; sample <= SAMPLE_COUNT; sample += 1) {
            const payload = exactPayload(rawBytes, sizeLabel, sample);
            const observation = observeFrameTextAfterAnimationFrame(
              page,
              payload.marker,
            ).then(() => performance.now());
            const acceptance = process
              .present(payload.input)
              .then(() => performance.now());
            const [observedAt, acceptedAt] = await Promise.all([
              observation,
              acceptance,
            ]);
            const milliseconds = Math.max(0, observedAt - acceptedAt);
            samples.push(milliseconds);
            if (milliseconds > MAX_LATENCY_MS) {
              failures.push({ sample, milliseconds });
            }
          }

          const report = {
            requirement: 'LIVE-011',
            rawBytes,
            sampleCount: samples.length,
            failures,
            isolation,
            metadata,
            medianMs: median(samples),
            p95Ms: percentile(samples, 0.95),
            maxMs: Math.max(...samples),
          };
          globalThis.process.stderr.write(
            `Agent Canvas latency evidence: ${JSON.stringify(report)}\n`,
          );

          expect(samples).toHaveLength(SAMPLE_COUNT);
          expect(failures, JSON.stringify(report)).toEqual([]);
        }
      } finally {
        await closeCanvasResources([browser, process]);
      }
    });
  }, 110_000);
});
