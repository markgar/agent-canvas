import { z } from 'zod';

export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('agent-canvas'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
