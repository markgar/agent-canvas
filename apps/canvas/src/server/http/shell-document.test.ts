import { describe, expect, it } from 'vitest';

import { createShellDocument } from './shell-document.js';

describe('createShellDocument', () => {
  it('creates a content-free trusted shell with the exact restrictive CSP', () => {
    const document = createShellDocument(() => new Uint8Array(16).fill(7));
    const nonce = Buffer.from(new Uint8Array(16).fill(7)).toString('base64url');

    expect(document.contentSecurityPolicy).toBe(
      `default-src 'none'; script-src 'self'; ` +
        `style-src 'self' 'nonce-${nonce}'; style-src-attr 'none'; ` +
        `connect-src 'self'; frame-src 'self'; base-uri 'none'; ` +
        `form-action 'none'; frame-ancestors 'none'`,
    );
    expect(document.html).toContain(
      `<link rel="stylesheet" href="/assets/main.css" nonce="${nonce}">`,
    );
    expect(document.html).toContain(
      '<script type="module" src="/assets/main.js"></script>',
    );
    expect(document.html).toContain('Nothing is displayed yet');
    expect(document.html).not.toMatch(
      /token=|agent_canvas_session|DisplaySnapshot|<iframe|srcdoc/i,
    );
    expect(document.html).not.toContain('<script>');
  });

  it('uses a fresh nonce for every shell document', () => {
    let fill = 1;
    const randomBytes = (size: number) => new Uint8Array(size).fill(fill++);

    const first = createShellDocument(randomBytes);
    const second = createShellDocument(randomBytes);
    expect(first.contentSecurityPolicy).not.toBe(second.contentSecurityPolicy);
    expect(first.html).not.toBe(second.html);
  });

  it('rejects a random source that cannot supply 128 nonce bits', () => {
    expect(() => createShellDocument(() => new Uint8Array(15))).toThrow(
      'invalid nonce length',
    );
  });
});
