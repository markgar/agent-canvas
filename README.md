# Agent Canvas

A local, general-purpose visual surface controlled by an AI assistant through MCP.
The assistant decides what to show; the user continues the conversation in chat.
Email is the first use case, not the application model.

**Status: repository scaffold.** The TypeScript development environment and a
loopback HTTP server are runnable. MCP, browser rendering, SSE, authentication,
and draft editing are not implemented yet. Do not supply real email or other
sensitive content to this scaffold.

## Start locally

Use Node.js 22.14+ (22.x) or 24.x and npm 10+. `.nvmrc` pins the default development
runtime; CI exercises both supported Node.js major versions.

```sh
nvm use
npm ci
npm run dev
```

The process prints its local address to **stderr**. Open `<printed-address>/health`
to see the JSON liveness response. The root URL has no browser UI yet.
Port zero is the default, allowing independent assistant sessions to coexist.

For a fixed port:

```sh
AGENT_CANVAS_PORT=3000 npm run dev
```

Use `127.0.0.1`, not `localhost`: the listener and Host/Origin policy use the exact
loopback address. There is no network-interface override. No `.env` file is
automatically loaded.

To run the compiled application:

```sh
npm run build
npm start
```

Once stdio MCP is implemented, MCP hosts should execute
`node /absolute/path/to/dist/server/main.js` directly, not `npm start`; npm's own
script output can contaminate the MCP transport.

## Repository map

```text
src/
  contracts/          Portable runtime schemas and inferred wire types
  server/
    config.ts         Validated environment configuration
    main.ts           Process startup, diagnostics, and shutdown
    http/             HTTP adapter and request boundary
  client/             Reserved browser boundary; implementation deferred
tests/
  integration/        Real HTTP and process-lifecycle tests
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

One deployable application and one dependency graph, with explicit internal
boundaries. This is intentionally not a monorepo or plugin platform.

## Development commands

| Command                 | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `npm run dev`           | Run the server with restart-on-change                     |
| `npm run build`         | Compile production server and contracts to `dist/`        |
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
The shared browser build tools are present without a browser UI. Install the pinned
Chromium binary with `npm run browser:install` before browser acceptance.
CI uses macOS for both supported Node versions so future browser assertions run
on the feature's supported platform rather than being skipped on Linux.

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
