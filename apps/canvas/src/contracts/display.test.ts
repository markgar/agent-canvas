import { describe, expect, it } from 'vitest';

import {
  canvasClearInputSchema,
  canvasGetStatusInputSchema,
  canvasPresentInputSchema,
  displaySnapshotSchema,
  displayTitleSchema,
  displayWarningsSchema,
  instanceIdSchema,
  mutationResultSchema,
  noArgumentsInputSchema,
  nonnegativeSafeIntegerSchema,
  presentViewInputSchema,
  statusResultSchema,
  toolFailureSchema,
} from './display.js';

const instanceId = '123e4567-e89b-42d3-a456-426614174000';

describe('display input contracts', () => {
  it('accepts only an empty object for no-argument tools', () => {
    expect(noArgumentsInputSchema.parse({})).toEqual({});
    expect(canvasGetStatusInputSchema.parse({})).toEqual({});
    expect(canvasClearInputSchema.parse({})).toEqual({});

    for (const value of [undefined, null, [], { unexpected: true }]) {
      expect(noArgumentsInputSchema.safeParse(value).success).toBe(false);
    }
  });

  it('defaults CSS while preserving valid title text exactly', () => {
    expect(
      canvasPresentInputSchema.parse({
        title: '  Synthetic message  ',
        html: '<p>Hello</p>',
      }),
    ).toEqual({
      title: '  Synthetic message  ',
      html: '<p>Hello</p>',
      css: '',
    });
  });

  it.each([
    null,
    {},
    { title: 'Title', html: '<p>Body</p>', extra: true },
    { title: 1, html: '<p>Body</p>' },
    { title: 'Title', html: 1 },
    { title: 'Title', html: '<p>Body</p>', css: 1 },
  ])('rejects malformed or expanded present input: %j', (value) => {
    expect(presentViewInputSchema.safeParse(value).success).toBe(false);
  });

  it('enforces trimmed nonempty titles and Unicode code-point limits', () => {
    expect(displayTitleSchema.safeParse(' \t\n ').success).toBe(false);
    expect(displayTitleSchema.safeParse('😀'.repeat(200)).success).toBe(true);
    expect(displayTitleSchema.safeParse('😀'.repeat(201)).success).toBe(false);
  });
});

describe('display output contracts', () => {
  it('accepts UUIDs and nonnegative safe integers only', () => {
    expect(instanceIdSchema.parse(instanceId)).toBe(instanceId);

    for (const value of ['not-a-uuid', '', 1]) {
      expect(instanceIdSchema.safeParse(value).success).toBe(false);
    }

    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(nonnegativeSafeIntegerSchema.parse(value)).toBe(value);
    }

    for (const value of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(nonnegativeSafeIntegerSchema.safeParse(value).success).toBe(false);
    }
  });

  it('requires warnings to be unique and canonically ordered', () => {
    expect(
      displayWarningsSchema.parse([
        'active-content',
        'navigation',
        'unsupported-css',
      ]),
    ).toEqual(['active-content', 'navigation', 'unsupported-css']);

    for (const warnings of [
      ['navigation', 'active-content'],
      ['navigation', 'navigation'],
      ['unknown-category'],
    ]) {
      expect(displayWarningsSchema.safeParse(warnings).success).toBe(false);
    }
  });

  it('validates strict snapshots and mutation results', () => {
    const view = { title: 'Title', html: '<p>Body</p>', css: '' };

    expect(
      displaySnapshotSchema.parse({ instanceId, revision: 0, view: null }),
    ).toEqual({ instanceId, revision: 0, view: null });
    expect(
      displaySnapshotSchema.parse({ instanceId, revision: 1, view }),
    ).toEqual({ instanceId, revision: 1, view });
    expect(
      mutationResultSchema.parse({
        instanceId,
        revision: 2,
        warnings: ['external-resource'],
      }),
    ).toEqual({
      instanceId,
      revision: 2,
      warnings: ['external-resource'],
    });

    expect(
      displaySnapshotSchema.safeParse({
        instanceId,
        revision: 0,
        view: null,
        history: [],
      }).success,
    ).toBe(false);
  });

  it('validates strict status and failure envelopes', () => {
    expect(
      statusResultSchema.parse({
        browserUrl: `http://127.0.0.1:3000/#${instanceId}`,
        instanceId,
        revision: 3,
        hasView: true,
        connectedBrowsers: 2,
      }),
    ).toEqual({
      browserUrl: `http://127.0.0.1:3000/#${instanceId}`,
      instanceId,
      revision: 3,
      hasView: true,
      connectedBrowsers: 2,
    });

    expect(
      toolFailureSchema.parse({
        code: 'INVALID_INPUT',
        message: 'The tool input is invalid.',
      }),
    ).toEqual({
      code: 'INVALID_INPUT',
      message: 'The tool input is invalid.',
    });

    expect(
      toolFailureSchema.safeParse({
        code: 'OTHER',
        message: 'Failure',
      }).success,
    ).toBe(false);
    expect(
      statusResultSchema.safeParse({
        browserUrl: 'not a URL',
        instanceId,
        revision: 0,
        hasView: false,
        connectedBrowsers: 0,
      }).success,
    ).toBe(false);
  });
});
