import { z } from 'zod';

const portSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(65535));

export function readConfig(env: Readonly<Record<string, string | undefined>>) {
  const result = portSchema.safeParse(env['AGENT_CANVAS_PORT'] ?? '0');

  if (!result.success) {
    throw new Error(
      'AGENT_CANVAS_PORT must be an integer between 0 and 65535 (0 selects an available port).',
    );
  }

  return {
    host: '127.0.0.1' as const,
    port: result.data,
  };
}

export type ServerConfig = ReturnType<typeof readConfig>;
