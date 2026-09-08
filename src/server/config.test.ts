import { describe, expect, it } from 'vitest';

import { readConfig } from './config.js';

describe('readConfig', () => {
  it('defaults to loopback and an available port', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 0 });
  });

  it.each(['0', '3000', '65535'])('accepts port %s', (port) => {
    expect(readConfig({ AGENT_CANVAS_PORT: port }).port).toBe(Number(port));
  });

  it.each(['', ' ', '-1', '65536', '1.5', '3000junk', 'Infinity', '1e3'])(
    'rejects invalid port %j without disclosing the input',
    (port) => {
      expect(() => readConfig({ AGENT_CANVAS_PORT: port })).toThrow(
        'AGENT_CANVAS_PORT must be an integer between 0 and 65535 (0 selects an available port).',
      );
    },
  );

  it('does not accept a host override', () => {
    expect(readConfig({ HOST: '0.0.0.0' }).host).toBe('127.0.0.1');
  });
});
