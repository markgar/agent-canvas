import { describe, expect, it, vi } from 'vitest';

import {
  MAX_NORMALIZED_CONTENT_BYTES,
  MAX_RAW_CONTENT_BYTES,
  displaySnapshotSchema,
  type DisplaySnapshot,
  type DisplayWarning,
} from '../../contracts/display.js';
import {
  createDisplayService,
  type DisplaySanitizer,
  type DisplayServiceClock,
  type SanitizerResult,
} from './display-service.js';

const instanceId = '123e4567-e89b-42d3-a456-426614174000';

function sanitized(overrides: Partial<SanitizerResult> = {}): SanitizerResult {
  return {
    html: '<p>Sanitized body</p>',
    css: '',
    text: 'Sanitized body',
    warnings: [],
    ...overrides,
  };
}

function createSanitizer(result: SanitizerResult = sanitized()) {
  return vi.fn<DisplaySanitizer>(() => result);
}

function expectFailure(
  outcome: Awaited<
    ReturnType<ReturnType<typeof createDisplayService>['present']>
  >,
  code: string,
) {
  expect(outcome).toEqual({
    ok: false,
    failure: {
      code,
      message:
        code === 'INVALID_INPUT'
          ? 'The tool input is invalid.'
          : code === 'TOO_LARGE'
            ? 'The display content exceeds the allowed size.'
            : code === 'EMPTY_CONTENT'
              ? 'The sanitized display has no visible text.'
              : 'The display service is unavailable.',
    },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('createDisplayService', () => {
  it('starts each unseeded instance at revision zero with a fresh UUID', () => {
    const first = createDisplayService({ sanitizer: createSanitizer() });
    const second = createDisplayService({ sanitizer: createSanitizer() });

    const firstSnapshot = first.getSnapshot();
    const secondSnapshot = second.getSnapshot();
    expect(displaySnapshotSchema.parse(firstSnapshot)).toEqual(firstSnapshot);
    expect(firstSnapshot).toMatchObject({ revision: 0, view: null });
    expect(secondSnapshot).toMatchObject({ revision: 0, view: null });
    expect(secondSnapshot.instanceId).not.toBe(firstSnapshot.instanceId);
  });

  it('does not carry retained content into a restarted service', async () => {
    const first = createDisplayService({ sanitizer: createSanitizer() });
    await first.present({ title: 'Current', html: '<p>Current</p>' });

    const restarted = createDisplayService({ sanitizer: createSanitizer() });

    expect(first.getSnapshot().view).not.toBeNull();
    expect(restarted.getSnapshot()).toMatchObject({ revision: 0, view: null });
    expect(restarted.getSnapshot().instanceId).not.toBe(
      first.getSnapshot().instanceId,
    );
  });

  it('retains sanitized content, preserves title text, and canonicalizes warnings', async () => {
    const sanitizer = createSanitizer(
      sanitized({
        html: '<p>Safe</p>',
        css: 'p { color: navy; }',
        text: 'Safe',
        warnings: [
          'unsupported-css',
          'active-content',
          'navigation',
          'active-content',
        ],
      }),
    );
    const service = createDisplayService({
      sanitizer,
      stateSeed: { instanceId, revision: 0, view: null },
    });

    await expect(
      service.present({
        title: '  Synthetic title  ',
        html: '<script>removed()</script><p>Safe</p>',
      }),
    ).resolves.toEqual({
      ok: true,
      result: {
        instanceId,
        revision: 1,
        warnings: ['active-content', 'navigation', 'unsupported-css'],
      },
    });
    expect(sanitizer).toHaveBeenCalledWith({
      html: '<script>removed()</script><p>Safe</p>',
      css: '',
    });
    expect(service.getSnapshot()).toEqual({
      instanceId,
      revision: 1,
      view: {
        title: '  Synthetic title  ',
        html: '<p>Safe</p>',
        css: 'p { color: navy; }',
      },
    });
  });

  it('accepts exact raw UTF-8 limits including multibyte content', async () => {
    const sanitizer = createSanitizer();
    const service = createDisplayService({
      sanitizer,
      stateSeed: { instanceId, revision: 0, view: null },
    });
    const exactMultibyteHtml = '😀'.repeat(MAX_RAW_CONTENT_BYTES / 4);

    await expect(
      service.present({
        title: 'Boundary',
        html: exactMultibyteHtml,
        css: '',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(sanitizer).toHaveBeenCalledOnce();
  });

  it('rejects raw UTF-8 overflow before sanitization without changing state', async () => {
    const sanitizer = createSanitizer();
    const initialState: DisplaySnapshot = {
      instanceId,
      revision: 7,
      view: { title: 'Existing', html: '<p>Existing</p>', css: '' },
    };
    const service = createDisplayService({
      sanitizer,
      stateSeed: initialState,
    });

    const outcome = await service.present({
      title: 'Too large',
      html: 'a'.repeat(MAX_RAW_CONTENT_BYTES),
      css: 'b',
    });

    expectFailure(outcome, 'TOO_LARGE');
    expect(sanitizer).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toEqual(initialState);
  });

  it('accepts the exact normalized limit and rejects one byte more atomically', async () => {
    const sanitizer = createSanitizer(
      sanitized({
        html: '😀'.repeat(MAX_NORMALIZED_CONTENT_BYTES / 4),
        text: 'a',
      }),
    );
    const service = createDisplayService({
      sanitizer,
      stateSeed: { instanceId, revision: 0, view: null },
    });

    await expect(
      service.present({ title: 'Exact', html: '<p>a</p>' }),
    ).resolves.toMatchObject({ ok: true, result: { revision: 1 } });
    const acceptedState = service.getSnapshot();

    sanitizer.mockResolvedValueOnce(
      sanitized({
        html: 'a'.repeat(MAX_NORMALIZED_CONTENT_BYTES),
        css: 'b',
        text: 'a',
      }),
    );
    const outcome = await service.present({
      title: 'Overflow',
      html: '<p>b</p>',
    });

    expectFailure(outcome, 'TOO_LARGE');
    expect(service.getSnapshot()).toEqual(acceptedState);
  });

  it('rejects text-empty and failed sanitizer results without mutation', async () => {
    const sanitizer = createSanitizer(sanitized({ text: ' \t\n ' }));
    const service = createDisplayService({
      sanitizer,
      stateSeed: { instanceId, revision: 4, view: null },
    });
    const initialState = service.getSnapshot();

    expectFailure(
      await service.present({
        title: 'Title alone is insufficient',
        html: '<div title="attribute only"><!-- comment --></div>',
      }),
      'EMPTY_CONTENT',
    );
    expect(service.getSnapshot()).toEqual(initialState);

    sanitizer.mockRejectedValueOnce(new Error('unsafe internal detail'));
    expectFailure(
      await service.present({ title: 'Failure', html: '<p>Body</p>' }),
      'UNAVAILABLE',
    );
    expect(service.getSnapshot()).toEqual(initialState);

    sanitizer.mockResolvedValueOnce({
      html: '<p>Body</p>',
      css: '',
      text: 'Body',
      warnings: ['invalid-warning' as DisplayWarning],
    });
    expectFailure(
      await service.present({ title: 'Malformed result', html: '<p>Body</p>' }),
      'UNAVAILABLE',
    );
    expect(service.getSnapshot()).toEqual(initialState);
  });

  it.each([
    null,
    {},
    { title: 'Title', html: '<p>Body</p>', extra: true },
    { title: 1, html: '<p>Body</p>' },
    { title: ' ', html: '<p>Body</p>' },
    { title: '😀'.repeat(201), html: '<p>Body</p>' },
  ])(
    'rejects invalid input without sanitizing or mutating: %j',
    async (input) => {
      const sanitizer = createSanitizer();
      const initialState: DisplaySnapshot = {
        instanceId,
        revision: 2,
        view: { title: 'Existing', html: '<p>Existing</p>', css: '' },
      };
      const service = createDisplayService({
        sanitizer,
        stateSeed: initialState,
      });

      expectFailure(await service.present(input), 'INVALID_INPUT');
      expect(sanitizer).not.toHaveBeenCalled();
      expect(service.getSnapshot()).toEqual(initialState);
    },
  );

  it('serializes complete present and clear operations in call-entry order', async () => {
    const firstTurn = deferred();
    let turns = 0;
    const clock: DisplayServiceClock = {
      waitForTurn() {
        turns += 1;
        return turns === 1 ? firstTurn.promise : undefined;
      },
    };
    const sanitizer = createSanitizer();
    const service = createDisplayService({
      sanitizer,
      clock,
      stateSeed: { instanceId, revision: 0, view: null },
    });

    const presentResult = service.present({
      title: 'First',
      html: '<p>First</p>',
    });
    const clearResult = service.clear({});

    await Promise.resolve();
    expect(sanitizer).not.toHaveBeenCalled();
    expect(turns).toBe(1);

    firstTurn.resolve();
    await expect(presentResult).resolves.toMatchObject({
      ok: true,
      result: { revision: 1 },
    });
    await expect(clearResult).resolves.toEqual({
      ok: true,
      result: { instanceId, revision: 2, warnings: [] },
    });
    expect(turns).toBe(2);
    expect(service.getSnapshot()).toEqual({
      instanceId,
      revision: 2,
      view: null,
    });
  });

  it('does not let a rejected queued call consume a revision', async () => {
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 0, view: null },
    });

    const rejected = service.present({
      title: ' ',
      html: '<p>Rejected</p>',
    });
    const cleared = service.clear({});

    expectFailure(await rejected, 'INVALID_INPUT');
    await expect(cleared).resolves.toEqual({
      ok: true,
      result: { instanceId, revision: 1, warnings: [] },
    });
  });

  it('orders a concurrent clear before a later present call', async () => {
    const firstTurn = deferred();
    let turns = 0;
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: {
        instanceId,
        revision: 8,
        view: { title: 'Existing', html: '<p>Existing</p>', css: '' },
      },
      clock: {
        waitForTurn() {
          turns += 1;
          return turns === 1 ? firstTurn.promise : undefined;
        },
      },
    });

    const clearResult = service.clear({});
    const presentResult = service.present({
      title: 'Replacement',
      html: '<p>Replacement</p>',
    });

    firstTurn.resolve();
    await expect(clearResult).resolves.toMatchObject({
      ok: true,
      result: { revision: 9 },
    });
    await expect(presentResult).resolves.toMatchObject({
      ok: true,
      result: { revision: 10 },
    });
    expect(service.getSnapshot()).toMatchObject({
      revision: 10,
      view: { title: 'Replacement' },
    });
  });

  it('increments every clear, including when the view is already empty', async () => {
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 0, view: null },
    });

    await expect(service.clear({})).resolves.toMatchObject({
      ok: true,
      result: { revision: 1, warnings: [] },
    });
    await expect(service.clear({})).resolves.toMatchObject({
      ok: true,
      result: { revision: 2, warnings: [] },
    });
    expectFailure(await service.clear({ unexpected: true }), 'INVALID_INPUT');
    expect(service.getSnapshot()).toEqual({
      instanceId,
      revision: 2,
      view: null,
    });
  });

  it('refuses revision overflow with a fixed content-free failure', async () => {
    const initialState: DisplaySnapshot = {
      instanceId,
      revision: Number.MAX_SAFE_INTEGER,
      view: { title: 'Existing', html: '<p>Secret</p>', css: '' },
    };
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: initialState,
    });

    const presentResult = await service.present({
      title: 'Replacement',
      html: '<p>Replacement</p>',
    });
    const clearResult = await service.clear({});

    expectFailure(presentResult, 'UNAVAILABLE');
    expectFailure(clearResult, 'UNAVAILABLE');
    expect(JSON.stringify([presentResult, clearResult])).not.toContain(
      'Secret',
    );
    expect(service.getSnapshot()).toEqual(initialState);
  });

  it('retains before deferred publication and does not await browser delivery', async () => {
    const delivery = deferred();
    const published: DisplaySnapshot[] = [];
    let pendingDelivery: Promise<void> | undefined;
    const publish = vi.fn((snapshot: DisplaySnapshot) => {
      published.push(snapshot);
      pendingDelivery = delivery.promise;
    });
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 0, view: null },
      publish,
      onPublicationFailure: vi.fn(),
    });

    const outcome = await service.present({
      title: 'Published',
      html: '<p>Published</p>',
    });

    expect(outcome).toMatchObject({ ok: true, result: { revision: 1 } });
    expect(service.getSnapshot().revision).toBe(1);
    expect(publish).toHaveBeenCalledOnce();
    expect(published[0]).toEqual(service.getSnapshot());
    expect(pendingDelivery).toBe(delivery.promise);
    delivery.resolve();
  });

  it('keeps accepted state when deferred publication throws', async () => {
    const onPublicationFailure = vi.fn();
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 0, view: null },
      publish() {
        throw new Error('writer failed');
      },
      onPublicationFailure,
    });

    await expect(
      service.present({ title: 'Retained', html: '<p>Retained</p>' }),
    ).resolves.toMatchObject({ ok: true, result: { revision: 1 } });
    await Promise.resolve();
    expect(onPublicationFailure).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      view: { title: 'Retained' },
    });
  });

  it('maps scheduling failures to UNAVAILABLE without changing state', async () => {
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 5, view: null },
      clock: {
        waitForTurn() {
          throw new Error('scheduler failed');
        },
      },
    });

    expectFailure(
      await service.present({ title: 'Title', html: '<p>Body</p>' }),
      'UNAVAILABLE',
    );
    expect(service.getSnapshot()).toEqual({
      instanceId,
      revision: 5,
      view: null,
    });
  });

  it('maps clear scheduling failures to UNAVAILABLE without changing state', async () => {
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 6, view: null },
      clock: {
        waitForTurn() {
          throw new Error('scheduler failed');
        },
      },
    });

    expectFailure(await service.clear({}), 'UNAVAILABLE');
    expect(service.getSnapshot()).toEqual({
      instanceId,
      revision: 6,
      view: null,
    });
  });

  it('returns snapshot copies that cannot mutate retained state', async () => {
    const service = createDisplayService({
      sanitizer: createSanitizer(),
      stateSeed: { instanceId, revision: 0, view: null },
    });
    await service.present({ title: 'Retained', html: '<p>Body</p>' });

    const externalSnapshot = service.getSnapshot();
    externalSnapshot.revision = 99;
    if (externalSnapshot.view !== null) {
      externalSnapshot.view.title = 'Mutated';
    }

    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      view: { title: 'Retained' },
    });
  });
});
