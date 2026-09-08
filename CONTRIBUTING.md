# Contributing

## Setup and workflow

1. Use the Node.js version in `.nvmrc` and run `npm ci`.
2. Read `SPEC.md` and `docs/architecture.md` before changing boundaries.
3. Make a focused change with tests beside the affected module.
4. Run the smallest relevant tests while iterating, for example
   `npm test -- src/server/config.test.ts`.
5. Run `npm run check` before opening a pull request.

Commit `package-lock.json` with dependency changes. Use npm, not a second package
manager. Install dependencies when they have a concrete use; do not preinstall a
future browser framework, MCP SDK, database, or deployment stack.

Keep Vitest and its coverage provider on the same exact version. They currently
use 4.0.18 because npm 10's peer resolver fails on the 4.1 dependency graph.
The lockfile retains integrity hashes but omits registry-specific download URLs
so installations respect each developer's configured registry.

## Code conventions

- TypeScript with strict checking and native ESM; use `.js` in relative source
  imports so compiled Node.js imports resolve without alias rewriting.
- Runtime schemas are the source of truth for external payloads. Infer types
  instead of maintaining a parallel interface.
- Keep HTTP and MCP handlers thin. Introduce transport-independent application
  logic as the first real display feature requires it.
- Prefer explicit dependencies and factories to module-global mutable state.
- Do not add `any`, double casts, disabled lint rules, or broad success-shaped
  fallbacks to make a check pass.
- Keep stdout reserved for MCP. Diagnostics belong on stderr, without user
  content, credentials, access URLs, or draft text.
- Comments explain non-obvious decisions, not line-by-line mechanics.

## Tests and definition of done

Unit tests live alongside source as `*.test.ts`. Cross-module HTTP and process
tests live in `tests/integration/`. Tests use ephemeral ports, close resources, and
must not depend on external services, credentials, or real email.

A change is ready when it has the relevant success and failure coverage, preserves
module boundaries, passes the quality gate, and updates directly affected docs.
Security-sensitive display work must include negative tests for the boundaries in
`SPEC.md`; the scaffold's health checks are not evidence that HTML rendering is safe.

Add browser tests when the browser exists. Do not substitute DOM snapshots for
real-browser coverage of sandboxing, network isolation, or SSE reconnect behavior.

## Architecture changes

Record significant changes to transport, persistence, trust boundaries, or
deployment shape in `docs/decisions/`. Small implementation details do not need an
ADR. Describe the context, decision, alternatives, and consequences.

Branch protection and required checks are repository-host settings, not enforced
by files in this scaffold. A maintainer should require the CI checks and review
before merging; no remote settings are changed by this setup.

## Specifications and Chainkit

Use the [spec-authoring skill](.github/skills/build-spec/SKILL.md) and
[`specs/TEMPLATE.md`](specs/TEMPLATE.md) for an implementable feature contract.
Review observable behavior, negative cases, affected code, and the actual acceptance
commands before recording approval. Completed specs are historical; promote durable
decisions into current architecture, invariants, schemas, and tests.

Read the [build-system rationale](docs/build-system.md) for the evidence and tradeoffs,
and the [operating guide](.chainkit/README.md) before executing a chain. Free validation
is part of `npm run check`; model execution is not. Build tooling has focused tests
under `.chainkit/scripts/`; the coverage percentage currently measures application
source, not the vendored executor or subprocess-executed tooling.

`vendor/chainkit/` is a complete pinned upstream snapshot, including upstream's own
package-manager files. These are provenance, not another workspace to install.
The root npm dependency graph supplies its `yaml` runtime dependency. Do not run
pnpm installs or formatters in the vendor directory. Changes to the pin and consumer
policy must be reviewed independently from a feature that uses them.
