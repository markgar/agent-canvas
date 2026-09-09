import { z } from 'zod';

export const MAX_TITLE_CODE_POINTS = 200;
export const MAX_RAW_CONTENT_BYTES = 512 * 1024;
export const MAX_NORMALIZED_CONTENT_BYTES = 1024 * 1024;

export const displayWarningValues = [
  'active-content',
  'external-resource',
  'navigation',
  'unsupported-markup',
  'unsupported-css',
] as const;

export const displayWarningSchema = z.enum(displayWarningValues);

export const displayWarningsSchema = z
  .array(displayWarningSchema)
  .superRefine((warnings, context) => {
    let previousIndex = -1;

    for (const warning of warnings) {
      const currentIndex = displayWarningValues.indexOf(warning);
      if (currentIndex <= previousIndex) {
        context.addIssue({
          code: 'custom',
          message: 'Warnings must be unique and use the canonical order.',
        });
        return;
      }
      previousIndex = currentIndex;
    }
  });

export const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

export const instanceIdSchema = z.uuid();

export const displayTitleSchema = z
  .string()
  .refine((title) => title.trim().length > 0, {
    message: 'Title must contain non-whitespace text.',
  })
  .refine(
    (title) => Array.from(title).length <= MAX_TITLE_CODE_POINTS,
    `Title must contain at most ${MAX_TITLE_CODE_POINTS.toString()} Unicode code points.`,
  );

export const noArgumentsInputSchema = z.strictObject({});

export const presentViewInputSchema = z.strictObject({
  title: displayTitleSchema,
  html: z.string(),
  css: z.string().optional().default(''),
});

export const canvasGetStatusInputSchema = noArgumentsInputSchema;
export const canvasPresentInputSchema = presentViewInputSchema;
export const canvasClearInputSchema = noArgumentsInputSchema;

export const displayViewSchema = z.strictObject({
  title: displayTitleSchema,
  html: z.string(),
  css: z.string(),
});

export const displaySnapshotSchema = z.strictObject({
  instanceId: instanceIdSchema,
  revision: nonnegativeSafeIntegerSchema,
  view: displayViewSchema.nullable(),
});

export const mutationResultSchema = z.strictObject({
  instanceId: instanceIdSchema,
  revision: nonnegativeSafeIntegerSchema,
  warnings: displayWarningsSchema,
});

export const statusResultSchema = z.strictObject({
  browserUrl: z.url(),
  instanceId: instanceIdSchema,
  revision: nonnegativeSafeIntegerSchema,
  hasView: z.boolean(),
  connectedBrowsers: nonnegativeSafeIntegerSchema,
});

export const toolFailureCodeSchema = z.enum([
  'INVALID_INPUT',
  'TOO_LARGE',
  'EMPTY_CONTENT',
  'UNAVAILABLE',
]);

export const toolFailureSchema = z.strictObject({
  code: toolFailureCodeSchema,
  message: z.string().min(1),
});

export type DisplayWarning = z.infer<typeof displayWarningSchema>;
export type NoArgumentsInput = z.infer<typeof noArgumentsInputSchema>;
export type PresentViewInput = z.input<typeof presentViewInputSchema>;
export type NormalizedPresentViewInput = z.output<
  typeof presentViewInputSchema
>;
export type CanvasGetStatusInput = z.infer<typeof canvasGetStatusInputSchema>;
export type CanvasPresentInput = z.input<typeof canvasPresentInputSchema>;
export type CanvasClearInput = z.infer<typeof canvasClearInputSchema>;
export type DisplayView = z.infer<typeof displayViewSchema>;
export type DisplaySnapshot = z.infer<typeof displaySnapshotSchema>;
export type MutationResult = z.infer<typeof mutationResultSchema>;
export type StatusResult = z.infer<typeof statusResultSchema>;
export type ToolFailureCode = z.infer<typeof toolFailureCodeSchema>;
export type ToolFailure = z.infer<typeof toolFailureSchema>;
