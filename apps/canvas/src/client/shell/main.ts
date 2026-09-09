import './main.css';

import { FrameRenderer } from '../rendering/frame.js';
import { DisplayConnection, type ConnectionStatus } from './connection.js';

const BOOTSTRAP_TIMEOUT_MS = 15_000;

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error('Trusted shell markup is incomplete.');
  }
  return element;
}

const statusElement = requireElement('#connection-status');
const contentElement = requireElement('.empty-state');
const titleElement = requireElement('#empty-title');
const detailElement = requireElement('#empty-detail');
const nonceElement = document.querySelector<HTMLLinkElement>('link[nonce]');
const styleNonce = nonceElement?.nonce ?? '';
const renderer = new FrameRenderer(
  document,
  {
    container: contentElement,
    title: titleElement,
    detail: detailElement,
  },
  styleNonce,
);
let connection: DisplayConnection | null = null;

function setState(
  status: string,
  detail?: string,
  connectionStatus?: ConnectionStatus,
): void {
  statusElement.textContent = status;
  if (connectionStatus === undefined) {
    delete statusElement.dataset['state'];
  } else {
    statusElement.dataset['state'] = connectionStatus;
  }
  if (detail !== undefined) {
    detailElement.textContent = detail;
  }
}

function startConnection(): void {
  if (connection !== null) {
    return;
  }

  connection = new DisplayConnection({
    visibility: {
      isHidden: () => document.hidden,
      addChangeListener: (listener) => {
        document.addEventListener('visibilitychange', listener);
      },
      removeChangeListener: (listener) => {
        document.removeEventListener('visibilitychange', listener);
      },
    },
    onSnapshot: (snapshot, action) => {
      if (action === 'replace') {
        renderer.render(snapshot.view);
      }
    },
    onStatus: (status) => {
      const label =
        status === 'connected'
          ? 'Connected'
          : status === 'reconnecting'
            ? 'Reconnecting'
            : 'Disconnected';
      setState(label, undefined, status);
    },
    onStale: (stale) => {
      renderer.setStale(stale);
    },
    onTerminalFailure: (failure) => {
      if (failure === 'access') {
        setState(
          'Disconnected',
          'Access denied. Open a fresh Agent Canvas access URL to continue.',
          'disconnected',
        );
        return;
      }
      setState(
        'Disconnected',
        'Connection error. The local Agent Canvas display stream returned an unexpected response.',
        'disconnected',
      );
    },
  });
  connection.start();
}

function takeFragmentToken(): { supplied: boolean; token: string } {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const supplied = parameters.has('token');
  const token = parameters.get('token') ?? '';
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  return { supplied, token };
}

function startBootstrap(token: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, BOOTSTRAP_TIMEOUT_MS);

  return fetch('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: controller.signal,
  }).finally(() => {
    window.clearTimeout(timeout);
  });
}

async function handleBootstrap(request: Promise<Response>): Promise<void> {
  const response = await request;
  if (response.status === 204) {
    setState('Session ready', 'Waiting for the assistant to present a view.');
    window.setTimeout(startConnection, 50);
    return;
  }
  if (response.status === 401 || response.status === 403) {
    setState(
      'Access denied',
      'Open a fresh Agent Canvas access URL to continue.',
      'disconnected',
    );
    return;
  }
  setState(
    'Unavailable',
    'The local Agent Canvas session could not be established.',
    'disconnected',
  );
}

function initialize(): void {
  const fragment = takeFragmentToken();
  const { supplied } = fragment;
  if (!supplied) {
    setState(
      'Reconnecting',
      'Checking the existing local browser session.',
      'reconnecting',
    );
    startConnection();
    return;
  }

  setState('Authorizing', 'Establishing a local browser session.');
  const request = startBootstrap(fragment.token);
  fragment.token = '';
  void handleBootstrap(request).catch(() => {
    setState(
      'Unavailable',
      'The local Agent Canvas session could not be established.',
      'disconnected',
    );
  });
}

window.addEventListener('pagehide', () => {
  connection?.stop();
});

initialize();
