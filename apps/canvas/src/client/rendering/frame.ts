import type { DisplayView } from '../../contracts/display.js';

const FRAME_CSP =
  "default-src 'none'; style-src 'nonce-{{nonce}}'; style-src-attr 'none'; " +
  "base-uri 'none'; form-action 'none'";

const TRUSTED_FRAME_CSS = `
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  padding: 1rem;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
pre {
  white-space: pre-wrap;
}
table {
  max-width: 100%;
}
`.trim();

function requireNonce(nonce: string): void {
  if (!/^[A-Za-z0-9_-]{22,}$/u.test(nonce)) {
    throw new Error('The trusted shell style nonce is invalid.');
  }
}

export function serializeFrameCss(css: string): string {
  return css.replaceAll('<', '\\3c ');
}

export function createFrameSource(view: DisplayView, nonce: string): string {
  requireNonce(nonce);
  const csp = FRAME_CSP.replace('{{nonce}}', nonce);
  const styles = `${TRUSTED_FRAME_CSS}\n${serializeFrameCss(view.css)}`;

  return (
    '<!doctype html><html><head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style nonce="${nonce}">${styles}</style>` +
    `</head><body>${view.html}</body></html>`
  );
}

export function createContentFrame(
  ownerDocument: Pick<Document, 'createElement'>,
  view: DisplayView,
  nonce: string,
): HTMLIFrameElement {
  const frame = ownerDocument.createElement('iframe');
  frame.className = 'content-frame';
  frame.title = 'Agent-provided display content';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', '');
  frame.srcdoc = createFrameSource(view, nonce);
  return frame;
}

export interface FrameRendererElements {
  container: HTMLElement;
  title: HTMLElement;
  detail: HTMLElement;
}

export class FrameRenderer {
  readonly #ownerDocument: Pick<Document, 'createElement'>;
  readonly #elements: FrameRendererElements;
  readonly #nonce: string;
  #frame: HTMLIFrameElement | null = null;
  #hasView = false;

  public constructor(
    ownerDocument: Pick<Document, 'createElement'>,
    elements: FrameRendererElements,
    nonce: string,
  ) {
    this.#ownerDocument = ownerDocument;
    this.#elements = elements;
    this.#nonce = nonce;
  }

  public get hasView(): boolean {
    return this.#hasView;
  }

  public render(view: DisplayView | null): void {
    if (view === null) {
      this.#frame?.remove();
      this.#frame = null;
      this.#hasView = false;
      this.#elements.container.className = 'empty-state';
      this.#elements.container.dataset['stale'] = 'false';
      this.#elements.title.textContent = 'Nothing is displayed yet';
      this.#elements.detail.hidden = false;
      this.#elements.detail.textContent =
        'Waiting for the assistant to present a view.';
      return;
    }

    const nextFrame = createContentFrame(
      this.#ownerDocument,
      view,
      this.#nonce,
    );
    this.#frame?.replaceWith(nextFrame);
    if (this.#frame === null) {
      this.#elements.container.append(nextFrame);
    }
    this.#frame = nextFrame;
    this.#hasView = true;
    this.#elements.container.className = 'content-region';
    this.#elements.container.dataset['stale'] = 'false';
    this.#elements.title.textContent = view.title;
    this.#elements.detail.hidden = true;
    this.#elements.detail.textContent = '';
  }

  public setStale(stale: boolean): void {
    this.#elements.container.dataset['stale'] =
      stale && this.#hasView ? 'true' : 'false';
    if (!this.#hasView) {
      return;
    }
    this.#elements.detail.hidden = !stale;
    this.#elements.detail.textContent = stale
      ? 'Displayed content may be stale while the local connection recovers.'
      : '';
  }
}
