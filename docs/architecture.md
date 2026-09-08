# Architecture

## Implemented foundation

Agent Canvas is one Node.js process and one npm package, compiled from TypeScript
to native ESM. Fastify owns HTTP routing and lifecycle. Zod defines runtime
contracts. Vitest, ESLint, Prettier, and TypeScript provide the automated quality
gate.

The current vertical slice is deliberately small:

```text
main.ts -> configuration -> HTTP adapter -> health contract
```

`createServer` constructs an unbound instance. Only the process entry point opens
a listener and installs signal handlers, so tests can construct and close isolated
servers without process-global side effects.

The process starts on an ephemeral loopback port by default. Invalid configuration
and occupied requested ports fail explicitly. Diagnostics use stderr. No content,
credentials, database, or browser session state exists yet.

## Dependency direction

| Area                  | May depend on                                               | Must not depend on                                  |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `src/contracts`       | Portable schemas and explicitly approved portable libraries | Server, browser implementation, Node.js/DOM globals |
| `src/server`          | Contracts, Node.js, server libraries                        | Browser implementation                              |
| `src/client` (future) | Contracts, browser APIs and portable libraries              | Server modules and Node.js                          |

ESLint enforces import boundaries; a separate TypeScript check compiles contracts
without ambient Node.js or DOM types. Tests may cross boundaries to exercise
integration behavior. Production builds exclude tests.

Use direct module imports instead of broad barrel files or runtime path aliases.
Organize by feature within each runtime boundary as features appear.

## Growth path

Add the following when the live-display feature is implemented, not as empty
frameworks in advance:

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

Both MCP and HTTP should call the same application operations. Do not put the
state store inside a route handler or make MCP call the server's own HTTP API.
Pass dependencies explicitly; avoid a service locator or dependency-injection
framework.

`tsconfig.server.json` and `tsconfig.client.json` check production Node and DOM
boundaries independently of the mixed test program; contracts remain portable.
The shared build compiles the server and bundles `src/client/shell/main.ts` with
esbuild when that entry exists. No browser application is manufactured while it
is absent. Playwright tooling is installed separately with `npm run browser:install`.
There is no prewritten live-feature acceptance suite in the chain-only baseline.

## When to split

Extract a package when a real second consumer needs a stable public API, or a
component has an independent release/deployment lifecycle. Directory count or
line count alone is not a reason to create a monorepo.

The knowledge service is a separate product boundary, not a database to add here.
Keep email authorization and execution in the assistant's existing integrations.

## Deliberate deferrals

- MCP SDK: install when implementing the stdio adapter.
- Browser application and feature tests: implement together in bounded chunks;
  minimal bundling and browser tooling are already available.
- Sanitizer and CSP: select and test together before accepting HTML.
- Persistence: in-memory current state first, with explicit restart semantics.
- Logging framework: add when useful, with redaction and stdout isolation.
- Deployment containers and release publishing: no remote deployment or public
  package is required for this local prototype.

The HTTP timeouts and body limit are scaffold defaults, not display-stream or
payload policies. Revisit them with SSE and enforce the product's payload limit at
the MCP input boundary.

## Build-system boundary

Chainkit is development tooling, not part of the running display server. Its pinned
snapshot under `vendor/chainkit/` stays unchanged. Agent Canvas owns `.chainkit/`
policy, prompts, acceptance adapters, and the feature specifications in `specs/`.
Production compilation excludes both. The [build-system design](build-system.md)
explains this separation, the invariant documents, the review loop, and the evidence
and limitations behind the approach.
