import { randomBytes as nodeRandomBytes } from 'node:crypto';

import type { RandomBytes } from '../security/browser-sessions.js';

const NONCE_BYTES = 16;

export interface ShellDocument {
  html: string;
  contentSecurityPolicy: string;
}

export function createShellDocument(
  randomBytes: RandomBytes = nodeRandomBytes,
): ShellDocument {
  const bytes = randomBytes(NONCE_BYTES);
  if (bytes.byteLength !== NONCE_BYTES) {
    throw new Error('Random source returned an invalid nonce length.');
  }
  const nonce = Buffer.from(bytes).toString('base64url');

  return {
    contentSecurityPolicy:
      `default-src 'none'; script-src 'self'; ` +
      `style-src 'self' 'nonce-${nonce}'; style-src-attr 'none'; ` +
      `connect-src 'self'; frame-src 'self'; base-uri 'none'; ` +
      `form-action 'none'; frame-ancestors 'none'`,
    html:
      '<!doctype html>' +
      '<html lang="en">' +
      '<head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Agent Canvas</title>' +
      `<link rel="stylesheet" href="/assets/main.css" nonce="${nonce}">` +
      '<script type="module" src="/assets/main.js"></script>' +
      '</head>' +
      '<body>' +
      '<main class="shell">' +
      '<header class="shell__header">' +
      '<div><p class="shell__eyebrow">Local visual surface</p>' +
      '<h1>Agent Canvas</h1></div>' +
      '<p id="connection-status" class="status" aria-live="polite">Initializing</p>' +
      '</header>' +
      '<section class="empty-state" aria-labelledby="empty-title">' +
      '<h2 id="empty-title">Nothing is displayed yet</h2>' +
      '<p id="empty-detail">Waiting for the assistant to present a view.</p>' +
      '</section>' +
      '</main>' +
      '</body>' +
      '</html>',
  };
}
