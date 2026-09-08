import './main.css';

const BOOTSTRAP_TIMEOUT_MS = 15_000;

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error('Trusted shell markup is incomplete.');
  }
  return element;
}

const statusElement = requireElement('#connection-status');
const detailElement = requireElement('#empty-detail');

function setState(status: string, detail: string): void {
  statusElement.textContent = status;
  detailElement.textContent = detail;
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
    return;
  }
  if (response.status === 401 || response.status === 403) {
    setState(
      'Access denied',
      'Open a fresh Agent Canvas access URL to continue.',
    );
    return;
  }
  setState(
    'Unavailable',
    'The local Agent Canvas session could not be established.',
  );
}

function initialize(): void {
  const { supplied, token } = takeFragmentToken();
  if (!supplied) {
    setState('Connecting', 'Checking the existing local browser session.');
    return;
  }

  setState('Authorizing', 'Establishing a local browser session.');
  void handleBootstrap(startBootstrap(token)).catch(() => {
    setState(
      'Unavailable',
      'The local Agent Canvas session could not be established.',
    );
  });
}

initialize();
