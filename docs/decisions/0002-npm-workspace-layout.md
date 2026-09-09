# 0002: Prepare an npm workspace for independent applications

## Status

Accepted

## Context

Agent Canvas began as one modular TypeScript application. A planned personal
knowledge system introduces a concrete second runtime boundary: a knowledge
service may ingest user-authorized source material, retain feedback, generate
embeddings, and perform retrieval. Those responsibilities do not belong in the
Canvas display process.

Keeping every future runtime at the repository root would blur ownership and make
their dependency and deployment boundaries harder to enforce. Extracting shared
libraries now would be speculative because Canvas is still their only consumer.

## Decision

Use npm workspaces with independently runnable applications under `apps/` and
potential shared libraries under `packages/`.

Move the existing application to `apps/canvas`. Keep repository-wide development
tooling, Chainkit policy, specifications, and the quality gate at the root. Root
commands continue to build, run, and validate Canvas so existing operator
workflows remain stable.

Do not create a knowledge-service application or shared package as part of this
layout change. Add an application only when its runtime contract is defined, and
extract a package only when at least two consumers require it. Applications may
depend on shared packages but must not import another application's internal
source files.

## Alternatives considered

- **Keep the single-package root:** simplest today, but the known second runtime
  would require another disruptive move when implementation begins.
- **Create all anticipated packages now:** produces artificial APIs and unused
  dependency boundaries before their consumers and responsibilities are known.
- **Put the knowledge service inside Canvas:** couples persistence and retrieval
  to the security-sensitive display process and conflicts with Canvas's existing
  product boundary.

## Consequences

- Canvas keeps its existing runtime behavior and app-local build configuration.
- The repository lockfile and common quality tooling remain centralized.
- Future applications have a clear location and can own their runtime
  dependencies.
- Some root-relative paths now include `apps/canvas`, and app-specific commands
  run through npm workspace forwarding.
- Shared contracts stay inside Canvas until another application genuinely needs
  them.
