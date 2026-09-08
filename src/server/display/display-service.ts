import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  MAX_NORMALIZED_CONTENT_BYTES,
  MAX_RAW_CONTENT_BYTES,
  displaySnapshotSchema,
  displayWarningSchema,
  displayWarningValues,
  canvasClearInputSchema,
  canvasPresentInputSchema,
  type DisplaySnapshot,
  type DisplayWarning,
  type MutationResult,
  type ToolFailure,
  type ToolFailureCode,
} from '../../contracts/display.js';
import { sanitizeDisplayContent } from '../security/sanitize-display.js';

const sanitizerResultSchema = z.strictObject({
  html: z.string(),
  css: z.string(),
  text: z.string(),
  warnings: z.array(displayWarningSchema),
});

const failureMessages = {
  INVALID_INPUT: 'The tool input is invalid.',
  TOO_LARGE: 'The display content exceeds the allowed size.',
  EMPTY_CONTENT: 'The sanitized display has no visible text.',
  UNAVAILABLE: 'The display service is unavailable.',
} as const satisfies Record<ToolFailureCode, string>;

export interface SanitizerInput {
  html: string;
  css: string;
}

export interface SanitizerResult {
  html: string;
  css: string;
  text: string;
  warnings: readonly DisplayWarning[];
}

export type DisplaySanitizer = (
  input: SanitizerInput,
) => SanitizerResult | Promise<SanitizerResult>;

export interface DisplayServiceClock {
  waitForTurn(): void | Promise<void>;
}

export interface DisplayServiceDependencies {
  sanitizer?: DisplaySanitizer;
  clock?: DisplayServiceClock;
  stateSeed?: DisplaySnapshot;
}

type DisplayPublicationDependencies =
  | {
      publish?: undefined;
      onPublicationFailure?: undefined;
    }
  | {
      publish: (snapshot: DisplaySnapshot) => void;
      onPublicationFailure: () => void;
    };

export type DisplayServiceOptions = DisplayServiceDependencies &
  DisplayPublicationDependencies;

export type MutationOutcome =
  { ok: true; result: MutationResult } | { ok: false; failure: ToolFailure };

export interface DisplayService {
  getSnapshot(): DisplaySnapshot;
  present(input: unknown): Promise<MutationOutcome>;
  clear(input: unknown): Promise<MutationOutcome>;
}

const systemClock: DisplayServiceClock = {
  waitForTurn() {},
};

function failure(code: ToolFailureCode): MutationOutcome {
  return {
    ok: false,
    failure: {
      code,
      message: failureMessages[code],
    },
  };
}

function cloneSnapshot(snapshot: DisplaySnapshot): DisplaySnapshot {
  return {
    instanceId: snapshot.instanceId,
    revision: snapshot.revision,
    view:
      snapshot.view === null
        ? null
        : {
            title: snapshot.view.title,
            html: snapshot.view.html,
            css: snapshot.view.css,
          },
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function canonicalWarnings(
  warnings: readonly DisplayWarning[],
): DisplayWarning[] {
  const presentWarnings = new Set(warnings);
  return displayWarningValues.filter((warning) => presentWarnings.has(warning));
}

export function createDisplayService(
  dependencies: DisplayServiceOptions,
): DisplayService {
  const clock = dependencies.clock ?? systemClock;
  const sanitizer = dependencies.sanitizer ?? sanitizeDisplayContent;
  const publication =
    dependencies.publish === undefined
      ? undefined
      : {
          publish: dependencies.publish,
          onFailure: dependencies.onPublicationFailure,
        };
  let snapshot = displaySnapshotSchema.parse(
    dependencies.stateSeed ?? {
      instanceId: randomUUID(),
      revision: 0,
      view: null,
    },
  );
  let operationQueue = Promise.resolve();

  const publish = (retainedSnapshot: DisplaySnapshot): void => {
    if (publication === undefined) {
      return;
    }

    const publishedSnapshot = cloneSnapshot(retainedSnapshot);
    queueMicrotask(() => {
      try {
        publication.publish(publishedSnapshot);
      } catch {
        publication.onFailure();
      }
    });
  };

  const enqueue = (operation: () => Promise<MutationOutcome>) => {
    const result = operationQueue.then(operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const retain = (
    view: DisplaySnapshot['view'],
    warnings: DisplayWarning[],
  ): MutationOutcome => {
    const nextRevision = snapshot.revision + 1;
    snapshot = {
      instanceId: snapshot.instanceId,
      revision: nextRevision,
      view,
    };
    const retainedSnapshot = snapshot;
    publish(retainedSnapshot);

    return {
      ok: true,
      result: {
        instanceId: retainedSnapshot.instanceId,
        revision: retainedSnapshot.revision,
        warnings,
      },
    };
  };

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },

    present(input) {
      return enqueue(async () => {
        try {
          await clock.waitForTurn();

          const parsedInput = canvasPresentInputSchema.safeParse(input);
          if (!parsedInput.success) {
            return failure('INVALID_INPUT');
          }

          const rawBytes =
            byteLength(parsedInput.data.html) +
            byteLength(parsedInput.data.css);
          if (rawBytes > MAX_RAW_CONTENT_BYTES) {
            return failure('TOO_LARGE');
          }

          const sanitizedResult = sanitizerResultSchema.safeParse(
            await sanitizer({
              html: parsedInput.data.html,
              css: parsedInput.data.css,
            }),
          );
          if (!sanitizedResult.success) {
            return failure('UNAVAILABLE');
          }

          const normalizedBytes =
            byteLength(sanitizedResult.data.html) +
            byteLength(sanitizedResult.data.css);
          if (normalizedBytes > MAX_NORMALIZED_CONTENT_BYTES) {
            return failure('TOO_LARGE');
          }
          if (sanitizedResult.data.text.trim().length === 0) {
            return failure('EMPTY_CONTENT');
          }
          if (snapshot.revision === Number.MAX_SAFE_INTEGER) {
            return failure('UNAVAILABLE');
          }

          return retain(
            {
              title: parsedInput.data.title,
              html: sanitizedResult.data.html,
              css: sanitizedResult.data.css,
            },
            canonicalWarnings(sanitizedResult.data.warnings),
          );
        } catch {
          return failure('UNAVAILABLE');
        }
      });
    },

    clear(input) {
      return enqueue(async () => {
        try {
          await clock.waitForTurn();

          if (!canvasClearInputSchema.safeParse(input).success) {
            return failure('INVALID_INPUT');
          }
          if (snapshot.revision === Number.MAX_SAFE_INTEGER) {
            return failure('UNAVAILABLE');
          }

          return retain(null, []);
        } catch {
          return failure('UNAVAILABLE');
        }
      });
    },
  };
}
