import { describe, expect, it } from 'vitest';

import type { DisplayView } from '../../contracts/display.js';
import {
  createContentFrame,
  createFrameSource,
  FrameRenderer,
  serializeFrameCss,
} from './frame.js';

const NONCE = 'AQEBAQEBAQEBAQEBAQEBAQ';
const VIEW: DisplayView = {
  title: 'Synthetic message',
  html: '<article><p id="generated-1">Safe body</p></article>',
  css: 'p { color: navy; }\n#generated-1 { color: maroon; }',
};

describe('frame rendering', () => {
  it('orders trusted metadata and typography before supplied sanitized rules and body', () => {
    const source = createFrameSource(VIEW, NONCE);
    const cspPosition = source.indexOf('Content-Security-Policy');
    const stylePosition = source.indexOf(`<style nonce="${NONCE}">`);
    const fieldRulePosition = source.indexOf('p { color: navy; }');
    const inlineRulePosition = source.indexOf(
      '#generated-1 { color: maroon; }',
    );
    const bodyPosition = source.indexOf(VIEW.html);

    expect(source).toContain(
      `default-src 'none'; style-src 'nonce-${NONCE}'; style-src-attr 'none'; base-uri 'none'; form-action 'none'`,
    );
    expect(cspPosition).toBeLessThan(stylePosition);
    expect(source.indexOf('font-family: system-ui')).toBeLessThan(
      fieldRulePosition,
    );
    expect(fieldRulePosition).toBeLessThan(inlineRulePosition);
    expect(inlineRulePosition).toBeLessThan(bodyPosition);
    expect(source).not.toContain('<script');
  });

  it('serializes CSS so authored text cannot terminate the trusted style element', () => {
    const escaped = serializeFrameCss(
      'p { color: red; } </style><script>bad()</script>',
    );
    expect(escaped).not.toContain('</style>');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('\\3c /style>');
  });

  it('constructs a fresh iframe with an empty sandbox and no session data', () => {
    const attributes = new Map<string, string>();
    const fakeFrame = {
      className: '',
      title: '',
      referrerPolicy: '',
      srcdoc: '',
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    };
    const ownerDocument = {
      createElement: () => fakeFrame,
    } as unknown as Pick<Document, 'createElement'>;

    const frame = createContentFrame(ownerDocument, VIEW, NONCE);

    expect(attributes.get('sandbox')).toBe('');
    expect(frame.srcdoc).toContain(VIEW.html);
    expect(frame.srcdoc).not.toMatch(/token=|agent_canvas_session/u);
    expect(frame.title).toBe('Agent-provided display content');
  });

  it('rejects a nonce that did not come from the trusted shell', () => {
    expect(() => createFrameSource(VIEW, 'authored-value')).toThrow(
      'trusted shell style nonce is invalid',
    );
  });

  it('replaces only the frame, preserves trusted title text, marks stale content, and clears to an empty state', () => {
    const frames: Array<{
      srcdoc: string;
      removed: boolean;
      replacedWith: unknown;
    }> = [];
    const ownerDocument = {
      createElement: () => {
        const frame = {
          className: '',
          title: '',
          referrerPolicy: '',
          srcdoc: '',
          removed: false,
          replacedWith: null as unknown,
          setAttribute() {},
          remove() {
            this.removed = true;
          },
          replaceWith(next: unknown) {
            this.replacedWith = next;
          },
        };
        frames.push(frame);
        return frame;
      },
    } as unknown as Pick<Document, 'createElement'>;
    const appended: unknown[] = [];
    const container = {
      className: 'empty-state',
      dataset: {} as DOMStringMap,
      append(value: unknown) {
        appended.push(value);
      },
    } as unknown as HTMLElement;
    const title = { textContent: '' } as HTMLElement;
    const detail = { textContent: '', hidden: false } as HTMLElement;
    const renderer = new FrameRenderer(
      ownerDocument,
      { container, title, detail },
      NONCE,
    );

    renderer.render(VIEW);
    const secondView = {
      ...VIEW,
      title: '<b>Trusted title text</b>',
      html: '<p>Replacement</p>',
    };
    renderer.render(secondView);
    renderer.setStale(true);

    expect(renderer.hasView).toBe(true);
    expect(container.className).toBe('content-region');
    expect(title.textContent).toBe('<b>Trusted title text</b>');
    expect(container.dataset['stale']).toBe('true');
    expect(detail.textContent).toContain('may be stale');
    expect(frames[0]?.replacedWith).toBe(frames[1]);
    expect(frames).toHaveLength(2);

    renderer.render(null);
    expect(renderer.hasView).toBe(false);
    expect(frames[1]?.removed).toBe(true);
    expect(container.className).toBe('empty-state');
    expect(title.textContent).toBe('Nothing is displayed yet');
    expect(detail.hidden).toBe(false);
  });
});
