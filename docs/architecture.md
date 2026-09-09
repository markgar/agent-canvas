# Architecture

## Implemented application

Agent Canvas is one Node.js process and one npm package, compiled from TypeScript
to native ESM with a bundled framework-free browser client. The official MCP SDK
owns stdio protocol framing. Fastify owns loopback HTTP routing and lifecycle.
Zod defines portable runtime contracts. Vitest, Playwright, ESLint, Prettier, and
TypeScript provide the automated quality gate.

The delivered data flow is:

```text
MCP host
  -> stdio tools
  -> validated/sanitized display operations
  -> serialized in-memory snapshot
  -> authenticated SSE subscribers
  -> trusted browser shell
  -> sandboxed content frame
```

`createRuntime` composes one display service, browser-session manager, Fastify
server, and MCP server. Both transports call the same transport-independent
display operations. `createServer` remains unbound; only the process entry point
opens the listener and installs shutdown handling.

The process binds exact IPv4 loopback on an ephemeral port by default. MCP protocol
output is the only stdout output; content-free diagnostics use stderr. SIGINT,
SIGTERM, and MCP stdin EOF close MCP, HTTP, and SSE resources. State, bootstrap
secrets, browser-session records, and sanitized content retained by the server
exist only in process memory. MCP hosts and browser profiles remain outside that
storage boundary and may retain URLs, cookies, or displayed data.

## Dependency direction

| Area            | May depend on                                               | Must not depend on                                  |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `src/contracts` | Portable schemas and explicitly approved portable libraries | Server, browser implementation, Node.js/DOM globals |
| `src/server`    | Contracts, Node.js, server libraries                        | Browser implementation                              |
| `src/client`    | Contracts, browser APIs and portable libraries              | Server modules and Node.js                          |

ESLint enforces import boundaries; a separate TypeScript check compiles contracts
without ambient Node.js or DOM types. Tests may cross boundaries to exercise
integration behavior. Production builds exclude tests.

Use direct module imports instead of broad barrel files or runtime path aliases.
Organize by feature within each runtime boundary as features appear.

## Runtime modules

```text
src/server/
  display/        Transport-independent state and application operations
  security/       Authentication and content sanitization
  mcp/            Official SDK adapter, delegating to display operations
  http/           Shell assets, authenticated SSE, browser session routes
src/client/
  shell/          Trusted browser state and connection handling
  rendering/      Isolated frame lifecycle
src/contracts/
  display.ts      Shared runtime schemas, revision and event contracts
```

The display service validates and sanitizes before entering its serialized
mutation section. It atomically retains one full current snapshot, advances the
revision once, and publishes after mutation. Rejected input cannot change state.
There is no history, persistence, or HTTP MCP endpoint.

`tsconfig.server.json` and `tsconfig.client.json` check production Node and DOM
boundaries independently of the mixed test program; contracts remain portable.
The build compiles server/contracts and bundles `src/client/shell/main.ts` with
esbuild. Tests may cross boundaries only to exercise real integration behavior.

## Browser access and rendering

The root route serves a public content-free shell. A high-entropy fragment secret
is exchanged once for an HttpOnly SameSite-strict cookie before content or SSE is
available. Host and applicable Origin are exact, CORS is not enabled, and sensitive
responses are `no-store`. Restarting creates a new instance and invalidates all
prior server-side access records; it cannot erase host or browser artifacts.

The browser uses a same-origin credentialed fetch stream rather than native
`EventSource`, allowing status inspection and named heartbeat validation. Each
connection begins with a complete snapshot. UTF-8 and SSE frames are incrementally
decoded under an 8 MiB partial-data cap; malformed events abort without reaching
the renderer. The browser compares instance/revision pairs, preserves the shell,
and replaces only the sandboxed frame for a newer view.

Valid snapshots and five-second heartbeat events provide liveness evidence.
Failure immediately marks retained content stale. Status changes from reconnecting
to disconnected after 15 seconds without evidence while one-at-a-time retries
continue. Each attempt has its own 15-second timeout, including when an aborted
fetch does not settle. Returning a stale tab to the foreground forces immediate
reconnection.

Each server connection has one active write and at most one pending latest
snapshot. Heartbeats are skipped during backpressure, and a writer still blocked
after five seconds is destroyed. The process accepts at most 32 authenticated SSE
streams and releases counts on every closure path.

Supplied HTML and CSS never enter the shell DOM. Sanitization uses explicit
text/table/flex-oriented allowlists, normalizes allowed styles into nonce-authorized
rules, and removes scripts, forms, navigation, remote resources, arbitrary SVG,
and other active content. The result is rendered in a sandbox without
`allow-scripts` or `allow-same-origin` and with a restrictive frame CSP.

## When to split

Extract a package when a real second consumer needs a stable public API, or a
component has an independent release/deployment lifecycle. Directory count or
line count alone is not a reason to create a monorepo.

The knowledge service is a separate product boundary, not a database to add here.
Keep email authorization and execution in the assistant's existing integrations.

## Deliberate boundaries and deferrals

- Node.js 22.14+ (22.x) is the runtime target. Node.js 24 compatibility is deferred.
- macOS with GitHub Copilot CLI and Chromium-based Chrome/Edge is the end-to-end
  target. Other operating systems, browsers, and MCP hosts are unverified.
- Browser opening is manual or a separate host capability; it is not an HTTP or
  MCP side effect.
- Editing, view history, persistence, remote hosting, multi-user state,
  infrastructure, knowledge services, embedded chat, and assistant wake-up are
  separate features.
- Canvas stores no email credentials and performs no source-system action. Real
  email requires explicit operator permission after synthetic safety evidence.
- Clearing and restart remove current process state but are not secure-erasure
  guarantees for browser memory, screenshots, or other local observers.

## Build-system boundary

Chainkit is development tooling, not part of the running display server. Its pinned
snapshot under `vendor/chainkit/` stays unchanged. Agent Canvas owns `.chainkit/`
policy, prompts, acceptance adapters, and the feature specifications in `specs/`.
Production compilation excludes both. The [build-system design](build-system.md)
explains this separation, the invariant documents, the review loop, and the evidence
and limitations behind the approach.
