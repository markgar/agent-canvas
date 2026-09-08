# Agent Canvas product invariants

Agent-Canvas-owned policy; generic vendored Chainkit remains unchanged.
Apply these invariants to planning, coding, and review. `SPEC.md` distinguishes
confirmed direction from proposals; a rule does not approve a feature.

- **PROD-001 — Purpose.** Provide a persistent, general-purpose visual surface
  beside assistant chat. Email is an example, not the domain model. The assistant
  owns reasoning and authorized source-system actions; Canvas owns presentation.
- **PROD-002 — Authority.** Canvas holds no email credentials and never retrieves,
  sends, or deletes mail. Browser interactions do not authorize external actions
  or wake an assistant. Real-email demonstrations require explicit manual
  permission for this surface; automation and tests use synthetic content only.
- **PROD-003 — Local boundary.** Bind only to `127.0.0.1`; validate Host and
  applicable Origin, prohibit permissive CORS, and authenticate display access
  and SSE. Never expose content before authentication and rendering boundaries
  exist. Bootstrap secrets belong in fragments, not query strings or logs.
- **PROD-004 — Untrusted rendering.** Treat all supplied HTML/CSS as hostile.
  Sanitize with explicit allowlists and isolate in a sandboxed frame with
  restrictive CSP. No supplied scripts, navigation, forms, remote resources,
  arbitrary SVG, or shell DOM insertion. Keep trusted identity/status outside it.
- **PROD-005 — Privacy.** Retain only sanitized current content in process memory.
  No content persistence, third-party assets, telemetry, or sensitive logs.
  Sensitive responses are no-store. Locality is not permission to handle
  classified, rights-managed, or otherwise restricted material.
- **PROD-006 — State.** One process owns one current view. Validate before atomic,
  serialized mutation; rejected input leaves state untouched. Accepted mutations
  advance revision; reconnect supplies the latest full snapshot without a gap.
  Restart loses content and invalidates credentials. Clearing is not secure erasure.
- **PROD-007 — Honest delivery.** Mutation success means server retention, not
  browser paint or human reading. Preserve the shell on updates; visibly label
  disconnected content as stale. Bound slow-client buffering; latest state wins.
- **PROD-008 — Architecture.** Keep one modular TypeScript application. Portable
  runtime schemas define inferred wire types; contracts import neither server
  nor browser globals. Server and browser do not import each other. Domain state
  is transport-independent. MCP alone writes stdout; diagnostics use stderr.
- **PROD-009 — Scope and truth.** Do not imply the scaffold already implements
  live display. Persistence, editing, multi-user/remote hosting, infrastructure,
  knowledge services, and host integration need separate explicit scope approval.
- **PROD-010 — Conflict.** Stop for human resolution when a feature spec conflicts
  with these invariants or repository guidance. Neither implementation convenience,
  a passing check, nor an agent-written plan grants permission to weaken them.
- **PROD-011 — Protected control plane.** Feature chains cannot edit build policy,
  vendored engine, specifications, or quality-gate files, even within a proposed
  chunk. Workflow and control-plane changes are separate human-reviewed work.
