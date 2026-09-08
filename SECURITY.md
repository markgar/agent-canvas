# Security

## Implemented controls

Agent Canvas binds only to `127.0.0.1`, validates exact Host and applicable Origin,
does not enable CORS, and disables request logging. Display state and SSE require
an HttpOnly same-origin browser session created from a high-entropy bootstrap
secret carried in a URL fragment. Sensitive responses use `Cache-Control:
no-store`; secrets and content are excluded from diagnostics.

Supplied HTML/CSS is treated as hostile, sanitized with explicit allowlists, and
rendered only in a sandboxed frame with restrictive CSP. Supplied scripts, forms,
navigation, remote resources, arbitrary SVG, and access to the trusted shell are
not permitted. The application retains only the current sanitized view and active
browser-session records in server process memory. It uses no content database/files,
application local storage, service workers, telemetry, or third-party browser
assets.

## Trust and privacy limits

The credential-bearing browser URL must be handled as a secret. Loopback binding
and browser authentication do not protect against malware, browser extensions, a
privileged local user, process inspection, screenshots, browser memory, or an MCP
host that mishandles content or credentials. Clearing is not secure erasure.
The server cannot guarantee that an MCP host or ordinary browser profile will not
retain tool results, credential URLs, cookies, history, cached process data, or
displayed content.

Canvas has no email credentials and never retrieves, sends, deletes, or otherwise
acts on mail. Displaying content does not authorize an external action or wake an
assistant. Do not supply classified, rights-managed, or otherwise restricted
material unless its handling requirements explicitly permit this local surface.
Local and memory-only are not sufficient permission.

Automated tests and committed fixtures use synthetic content only. A real-email
demonstration requires explicit operator consent after automated safety evidence;
that human acceptance is separate and is not claimed by the test suite. Human
Chrome, Edge, and GitHub Copilot CLI smoke acceptance also remains separate from
the pinned Playwright Chromium evidence.

The supported milestone runtime is Node.js 22.14+ (22.x) on macOS. Node.js 24,
Firefox, WebKit/Safari, Windows/Linux, and other MCP hosts are unverified. This is
a local prototype, not a remote-hosting or multi-user security boundary.

Do not add real messages, drafts, credentials, access tokens, bootstrap URLs,
session cookies, or private exploit data to fixtures, logs, issues, or commits.

## Reporting a vulnerability

Do not put sensitive details or exploit payloads containing private data in a
public issue. Use GitHub's private vulnerability reporting for this repository
if enabled. Otherwise ask the repository owner for a private reporting channel
without disclosing the vulnerability publicly.

No support SLA or production security guarantee is offered.
