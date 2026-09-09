import { describe, expect, it, vi } from 'vitest';

import type { DisplaySnapshot } from '../../contracts/display.js';
import {
  DisplaySseParser,
  MAX_PARTIAL_EVENT_BYTES,
  SseProtocolError,
} from './sse-parser.js';

const INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';

function snapshot(
  revision = 1,
  title = 'Synthetic message 😀',
): DisplaySnapshot {
  return {
    instanceId: INSTANCE_ID,
    revision,
    view: {
      title,
      html: '<p>Safe synthetic body</p>',
      css: 'p { color: navy; }',
    },
  };
}

function snapshotEvent(value = snapshot(), lineEnding = '\n'): string {
  return [
    'event: snapshot',
    `id: ${value.instanceId}:${value.revision.toString()}`,
    `data: ${JSON.stringify(value)}`,
    '',
    '',
  ].join(lineEnding);
}

describe('DisplaySseParser', () => {
  it('decodes split UTF-8 and partial LF frames before handling coalesced events', () => {
    const onSnapshot = vi.fn();
    const onHeartbeat = vi.fn();
    const parser = new DisplaySseParser({ onSnapshot, onHeartbeat });
    const bytes = new TextEncoder().encode(
      `${snapshotEvent()}event: heartbeat\ndata: {}\n\n`,
    );
    const emojiStart = bytes.indexOf(0xf0);

    parser.push(bytes.slice(0, emojiStart + 2));
    expect(onSnapshot).not.toHaveBeenCalled();
    parser.push(bytes.slice(emojiStart + 2));

    expect(onSnapshot).toHaveBeenCalledWith(snapshot());
    expect(onHeartbeat).toHaveBeenCalledOnce();
  });

  it('handles CRLF framing and comments without treating comments as liveness', () => {
    const onSnapshot = vi.fn();
    const onHeartbeat = vi.fn();
    const parser = new DisplaySseParser({ onSnapshot, onHeartbeat });

    parser.push(
      new TextEncoder().encode(
        `: keep-alive\r\n\r\n${snapshotEvent(snapshot(2), '\r\n')}: ignored\r\n\r\n`,
      ),
    );

    expect(onSnapshot).toHaveBeenCalledWith(snapshot(2));
    expect(onHeartbeat).not.toHaveBeenCalled();
  });

  it.each([
    ['heartbeat before snapshot', 'event: heartbeat\ndata: {}\n\n', 0],
    [
      'heartbeat payload',
      `${snapshotEvent()}event: heartbeat\ndata: {"extra":true}\n\n`,
      1,
    ],
    [
      'heartbeat ID',
      `${snapshotEvent()}event: heartbeat\nid: stray\ndata: {}\n\n`,
      1,
    ],
    ['unknown event', 'event: update\ndata: {}\n\n', 0],
    [
      'missing snapshot ID',
      `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`,
      0,
    ],
    [
      'inconsistent snapshot ID',
      `event: snapshot\nid: ${INSTANCE_ID}:9\ndata: ${JSON.stringify(snapshot())}\n\n`,
      0,
    ],
    [
      'invalid snapshot schema',
      `event: snapshot\nid: ${INSTANCE_ID}:1\ndata: {"instanceId":"${INSTANCE_ID}","revision":1,"view":{"title":"x"}}\n\n`,
      0,
    ],
    ['invalid JSON', `event: snapshot\nid: ${INSTANCE_ID}:1\ndata: {\n\n`, 0],
  ])(
    'rejects an invalid %s without invoking a callback for the invalid event',
    (_name, event, validSnapshots) => {
      const onSnapshot = vi.fn();
      const onHeartbeat = vi.fn();
      const parser = new DisplaySseParser({ onSnapshot, onHeartbeat });

      expect(() => {
        parser.push(new TextEncoder().encode(event));
      }).toThrow(SseProtocolError);
      expect(onSnapshot).toHaveBeenCalledTimes(validSnapshots);
      expect(onHeartbeat).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid UTF-8 and more than 8 MiB of partial data', () => {
    const handlers = { onSnapshot: vi.fn(), onHeartbeat: vi.fn() };

    expect(() => {
      new DisplaySseParser(handlers).push(
        Uint8Array.from([
          ...new TextEncoder().encode('event: snapshot\ndata: '),
          0xff,
          0x0a,
          0x0a,
        ]),
      );
    }).toThrow('invalid UTF-8');

    expect(() => {
      new DisplaySseParser(handlers).push(
        new Uint8Array(MAX_PARTIAL_EVENT_BYTES + 1),
      );
    }).toThrow('too large');
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });
});
