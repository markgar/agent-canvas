# ADR 0001: One modular TypeScript application

- Status: accepted for the repository scaffold
- Date: 2026-09-08

## Context

Agent Canvas is a local server plus a browser surface. The first milestone has one
process, one current view, and no independent deployment requirements. The project
should be understandable while learning, without blocking future growth.

## Decision

Use one private npm package with TypeScript, native ESM, and explicit server,
browser, and portable-contract boundaries. Start with Fastify for HTTP and Zod for
runtime validation. Keep browser and MCP implementation deferred until their
features are built. Use npm's lockfile and a CI quality gate.

Do not create workspaces, a plugin system, dependency-injection infrastructure, or
a database as part of scaffolding.

## Alternatives

- A workspace per runtime: useful for independent releases, but adds package and
  build orchestration before there are separate consumers.
- A single unstructured source directory: easy initially, but makes browser/server
  dependencies and trust boundaries harder to police.
- Handwritten HTTP routing: fewer dependencies, but pushes routing, lifecycle, and
  test-injection concerns into application code.

## Consequences

One installation, build, and quality gate are sufficient. Runtime boundaries are
visible and enforceable without package publishing. Extracting a package later
will require defining its public API, but direct imports and portable contracts
make that migration tractable.

Fastify is an adapter choice, not the home for future display state or business
rules. The unimplemented product decisions in `SPEC.md` remain proposals.
