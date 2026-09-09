# Agent Canvas

A local, general-purpose visual surface controlled by an AI assistant through MCP.
The assistant decides what to show; the user continues the conversation in chat.
Email is the first use case, not the application model.

**Status: standalone live display implemented.** One Node.js process exposes
three stdio MCP tools and a manually opened loopback browser surface. The browser
uses an authenticated SSE stream, retains the latest sanitized view in memory,
and replaces an isolated sandboxed frame without reloading the trusted shell.
Editing, persistence, remote hosting, multi-user sharing, email access/actions,
and host-specific browser integration are not implemented.

## Run with an MCP host

Use Node.js 22.14+ (22.x) and npm 10+. `.nvmrc` pins the supported development
runtime and routine CI uses the same major version. Node.js 24 compatibility is
deferred and is not claimed by this milestone.

```sh
nvm use
npm ci
npm run build
```

Configure the MCP host to execute the compiled entry point directly:

```text
node /absolute/path/to/repository/apps/canvas/dist/server/main.js
```

Do not use `npm start` as the MCP command because npm output can contaminate the
stdio protocol. The host discovers `canvas_get_status`, `canvas_present`, and
`canvas_clear`. `canvas_get_status` returns a credential-bearing browser URL.
Open that URL manually in a browser; hosts may open it only when they have an
explicit browser-opening capability. Separate assistant sessions should launch
separate processes.

The process binds only to `127.0.0.1` on an ephemeral port by default. Use
`AGENT_CANVAS_PORT=3000` in the host configuration when a fixed port is needed.
Use `127.0.0.1`, not `localhost`; Host and applicable Origin checks require the
exact listener authority. Startup diagnostics use stderr, MCP alone uses stdout,
and no `.env` file is loaded automatically.

For development outside an MCP host:

```sh
npm run dev
```

The root shell is content-free until the fragment bootstrap secret is exchanged
for an HttpOnly same-origin session. Treat the status URL as a credential: do not
share it, put it in logs, or reuse it after a restart.

## Delivered boundary

- One process owns one current sanitized view. Present and clear mutations are
  serialized; accepted mutations advance the revision. Restarting loses content
  and invalidates browser credentials.
- The browser receives full snapshots over authenticated SSE, visibly marks
  retained content stale during loss, retries one connection at a time, and
  recovers the latest snapshot. Slow streams retain at most one pending latest
  snapshot and are evicted after five seconds of backpressure.
- Supplied HTML/CSS is allowlisted and rendered in a scriptless sandboxed frame
  with restrictive CSP and no remote resources, forms, navigation, arbitrary SVG,
  or access to the trusted shell.
- Server-retained content and session records are process-memory-only. Sensitive
  responses are `no-store`; the application uses no telemetry, third-party assets,
  local storage, service workers, database, or content files.
- Canvas has no email credentials and never retrieves, sends, or deletes mail.
  Browser activity does not authorize external actions or wake an assistant.

Loopback and browser authentication do not protect against malware, a privileged
local user, screenshots, browser memory, or mishandling by the MCP host. Do not
display classified, rights-managed, or otherwise restricted material unless its
handling rules explicitly permit this surface. Automated fixtures are synthetic
only. The server cannot prevent an MCP host or ordinary browser profile from
retaining tool results, credential URLs, cookies, history, cached process data,
or displayed content outside the application.

The milestone support target is macOS, GitHub Copilot CLI as the MCP host, and
Chromium-based Chrome/Edge. Automated acceptance uses the pinned Playwright
Chromium build on Node.js 22.14+ (22.x). Firefox, WebKit/Safari, Windows/Linux,
other MCP hosts, and Node.js 24 are unverified. Human smoke testing in actual
Chrome, Edge, and GitHub Copilot CLI, plus an explicitly consented real-email
demonstration, remain outstanding and are not implied by automated results.

## Repository map

```text
apps/
  canvas/
    src/
      contracts/      Portable runtime schemas and inferred wire types
      server/         MCP, HTTP, display, and security implementation
      client/         Trusted shell and sandboxed frame rendering
    tests/
      browser/        Compiled-process Chromium behavior and security evidence
      integration/    Real MCP, HTTP, and process-lifecycle tests
    package.json      Canvas runtime dependencies and app-local commands
packages/             Reserved for libraries with a demonstrated second consumer
docs/
  architecture.md     Dependency rules and growth path
  build-system.md     Build architecture and evidence behind its design
  decisions/          Architecture decision records
specs/                Reviewed feature contracts and historical completed specs
.chainkit/            Agent Canvas policy, prompts, workflow, and checks
vendor/chainkit/      Unmodified, pinned generic executor (MIT)
.github/
  workflows/          Automated quality gate
```

The repository is an npm workspace with one deployable application today.
Additional applications belong under `apps/` only when they have an independent
runtime boundary. Shared packages belong under `packages/` only after a real
second consumer exists; the workspace layout is not a plugin system.

## Development commands

| Command                 | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `npm run dev`           | Run the server with restart-on-change                     |
| `npm run build`         | Compile Canvas to `apps/canvas/dist/`                     |
| `npm start`             | Run the compiled server                                   |
| `npm run typecheck`     | Check application/tests and environment-neutral contracts |
| `npm run lint`          | Type-aware linting and dependency-boundary rules          |
| `npm run format`        | Format supported repository files                         |
| `npm test`              | Run unit and integration tests                            |
| `npm run test:watch`    | Run tests while editing                                   |
| `npm run test:coverage` | Enforce the coverage floor                                |
| `npm run check`         | Run the same quality gate used in CI                      |

## Agent-assisted builds

The build system separates the unchanged Chainkit executor from Agent Canvas's
own invariant documents, feature specs, prompts, and acceptance checks. Start with
[the standalone design and research rationale](docs/build-system.md), then use
[the operating guide](.chainkit/README.md).

Use the [build-spec skill](.github/skills/build-spec/SKILL.md) for a reviewable
contract and [build-feature](.github/skills/build-feature/SKILL.md) for readiness
and an explicitly authorized launch. Feature tests can be written with each
implementation chunk; a complete prewritten test harness is not a prerequisite.
Install the pinned Chromium binary with `npm run browser:install` before browser
acceptance. CI uses macOS/Node.js 22, runs `npm run check`, and installs Chromium
for the compiled browser cases. Vendored Chainkit self-tests remain available
through `npm run chainkit:selftest` rather than running on every change.

`npm run chainkit:validate` checks the vendor pin, spec structure, and chain wiring
without calling a model. `npm run chainkit:selftest` runs upstream offline tests.

The first [live-display feature spec](specs/001-live-display.md) records its review
status in frontmatter. Execution requires an approved, current spec, a clean committed
worktree, and an explicit `--execute` flag. Runs spend model credits and create local
checkpoint commits; they do not push or merge.

## Design and contributions

- [Product specification](SPEC.md): requirements, scope, and acceptance criteria.
- [Architecture](docs/architecture.md): implemented boundaries and planned growth.
- [Initial architecture decision](docs/decisions/0001-modular-typescript-application.md).
- [Contributing](CONTRIBUTING.md): workflow and definition of done.
- [Security](SECURITY.md): limitations and responsible reporting.

No open-source license has been selected. The package is private and marked
`UNLICENSED` to prevent accidental publication or implied licensing. Vendored
Chainkit retains its own [MIT license](vendor/chainkit/LICENSE).
