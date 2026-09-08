import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts the public liveness response', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', service: 'agent-canvas' }),
    ).toEqual({ status: 'ok', service: 'agent-canvas' });
  });

  it.each([
    null,
    {},
    { status: 'error', service: 'agent-canvas' },
    { status: 'ok', service: 'another-service' },
    { status: 'ok', service: 'agent-canvas', secret: 'must-not-be-exposed' },
  ])('rejects malformed or expanded responses: %j', (value) => {
    expect(healthResponseSchema.safeParse(value).success).toBe(false);
  });
});
