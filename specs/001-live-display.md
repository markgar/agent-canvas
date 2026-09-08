---
id: 001-live-display
title: Live read-only display
status: draft
base_commit: ba83a0898223c36579ed2da605cda12f91ad267a
approved_by: null
approved_at: null
checks:
  - id: scaffold-types
    command: [npm, run, typecheck]
  - id: live-core
    command:
      - node
      - node_modules/vitest/vitest.mjs
      - run
      - tests/integration/live-display.test.ts
  - id: live-security
    command:
      - node
      - node_modules/vitest/vitest.mjs
      - run
      - tests/integration/live-security.test.ts
  - id: live-browser
    command: [node, scripts/check-live-browser.mjs]
---

## Outcome

A persistent browser surface beside chat receives MCP replacement/clear updates
and reconnects to the latest view. Email with a separate recommendation demonstrates
a general-purpose surface, not an email application.

**Reviewable draft:** milestone 1 of `SPEC.md`, not implementation approval.
Only the TypeScript/Node.js/Fastify/Zod scaffold and loopback health server exist;
MCP, auth, rendering, and SSE contracts below are proposals for human review.
Re-ground this draft against the committed foundation before approving execution.

## Scope

Include one process/current view, observing tabs, stdio MCP, authenticated shell,
sanitized HTML/CSS, replacement/clear, SSE, memory-only recovery, synthetic and
separately consented real-email demonstrations. Browser opening is manual or a
host capability. Separate assistant sessions launch separate processes.

Exclude email credentials/retrieval/actions, editing/forms, supplied JavaScript,
DOM patching, history/persistence, remote hosting, multi-user sharing, infrastructure,
embedded chat, assistant wake-up, host-specific integration, and knowledge services.
No real email is supplied to the scaffold or automated validation.

Governance: [product](../.chainkit/governance/product.md), [planning](../.chainkit/governance/planning.md), [coding](../.chainkit/governance/coding.md), [reviewing](../.chainkit/governance/reviewing.md).

## Requirements

- **LIVE-001:** A supported host launches the compiled process directly over stdio
  and discovers the three tools below. HTTP serves only the browser, not MCP.
  Only protocol output reaches stdout; startup/transport failure is actionable
  on stderr without content or credentials. Shutdown closes HTTP/SSE and MCP.
- **LIVE-002:** Status supplies a credential-bearing browser URL, instance ID,
  revision, view presence, and authenticated SSE connection count. Manual opening
  works. Never interpret connections or accepted mutations as paint/read receipts.
- **LIVE-003:** Validate and sanitize before mutation. Enforce the exact schemas
  and limits below; invalid, oversized, or meaninglessly filtered input returns
  an error and leaves revision/view unchanged. Never echo supplied content.
- **LIVE-004:** Start with a fresh instance ID, revision 0, and null view. Serialize
  accepted present/clear calls; atomically retain only sanitized state, increment
  once, and publish. Clear increments even when already empty. Restart resets
  state and invalidates all prior secrets/sessions; no content history.
- **LIVE-005:** Every authenticated SSE connection immediately receives the latest
  full snapshot, including after reconnect with Last-Event-ID. Subscription and
  initial delivery have no missed-update gap. Bound slow-client buffering.
- **LIVE-006:** Preserve the browser shell across updates; replace only its isolated
  content frame. Ignore duplicate/older revisions for the same instance; reset
  comparison on a new instance. Show connected/reconnecting/disconnected status.
  Retain the last view with a stale warning during loss; clear renders empty state.
- **LIVE-007:** Sanitize hostile HTML/CSS and sandbox as below; no active content,
  remote requests, link navigation, shell styling, forms, or arbitrary SVG.
  Render title as text; trusted identity and connection status remain outside.
- **LIVE-008:** Bind only exact loopback, enforce Host/Origin, and authenticate
  state/SSE using the bootstrap/session contract below. Reject missing/invalid
  credentials and cross-origin bootstrap without exposing content.
- **LIVE-009:** Use no-store sensitive responses and local assets only. No content,
  secrets, cookies, or input snippets in logs/errors; no local storage, service
  workers, application-file content, telemetry, or third-party resources.
- **LIVE-010:** Demonstrate synthetic email headers/body and a visually separate
  “Assistant recommendation”; preserve source versus summary distinctions and
  never invent missing headers. Only a manual explicitly permitted real-email
  demonstration follows successful safety validation.
- **LIVE-011:** Under the proposed foreground local measurement below, accepted
  updates become visible within one second. Connection loss is visible within
  15 seconds; slow observers cannot cause unlimited server pending snapshots.

## Design

**Load-bearing proposed wire contracts**

Use official TypeScript MCP SDK stdio and portable runtime schemas with inferred
types. Input objects reject unknown keys. No-argument tool inputs are `{}`.

```text
type DisplayView = { title: string; html: string; css: string };
type DisplaySnapshot = {
  instanceId: string; revision: number; view: DisplayView | null;
};
type MutationResult = {
  instanceId: string; revision: number; warnings: string[];
};
type StatusResult = {
  browserUrl: string; instanceId: string; revision: number;
  hasView: boolean; connectedBrowsers: number;
};
type ToolFailure = {
  code: "INVALID_INPUT" | "TOO_LARGE" | "EMPTY_CONTENT" | "UNAVAILABLE";
  message: string;
};
```

`instanceId` is a freshly generated UUID per process; revision/count are
nonnegative safe integers. Reject further mutations as `UNAVAILABLE` rather
than overflow revision. `canvas_get_status({})` returns `StatusResult`;
`canvas_present({title, html, css?})` and `canvas_clear({})` return `MutationResult`.
MCP success uses `structuredContent: result` plus
`content: [{type: "text", text: JSON.stringify(result)}]`; tool failure uses
`isError: true` and the same text shape encoding `ToolFailure`. Unknown tool or
malformed MCP protocol messages follow SDK protocol errors, not domain mutation.

Title is nonblank plain text, at most 200 Unicode code points. HTML is a string;
CSS is an optional string defaulting to `""`. Combined raw HTML/CSS UTF-8 size
must be at most 524288 bytes, inclusive, before sanitization. Size overflow
uses `TOO_LARGE`, malformed/schema input `INVALID_INPUT`, and sanitized content
without non-whitespace visible text `EMPTY_CONTENT` (even if title is present).
Warnings are deduplicated category strings from `active-content`,
`external-resource`, `navigation`, `unsupported-markup`, `unsupported-css`;
never fragments of input. Clear returns `warnings: []`.

**Proposed browser access contract**

- Browser URL: `http://127.0.0.1:<port>/#token=<base64url-secret>`, using 32 random
  bytes per process. Root/assets are public but carry no display data or secrets.
  Shell reads the fragment into memory, immediately removes it with history
  replacement, then exchanges it; never sends it in a URL or persists it.
- `POST /session`, JSON `{token: string}` only, requires
  `Content-Type: application/json` and exact Origin `http://127.0.0.1:<port>`.
  Compare secret safely; valid exchange returns 204 with no body and an opaque
  32-random-byte session cookie:
  `agent_canvas_session_<port>=<value>; HttpOnly; SameSite=Strict; Path=/`.
  Cookie names include the bound port because cookies do not isolate by port.
  Cookie is host-only and session-only; no Secure attribute on this HTTP-only
  loopback proposal. Credentials are invalid outside their generating process.
- Bootstrap secret remains valid for opening further tabs during that process;
  cap active session records at 32 and reject excess exchanges with 429 rather
  than grow memory unboundedly. No browser mutation endpoint beyond bootstrap.
- Validate exact Host with the bound port on all routes; reject any supplied
  nonmatching Origin. Missing Origin is allowed for GET, never for bootstrap.
  No CORS opt-in. Malformed/unknown bootstrap fields: 400; disallowed Host/Origin:
  403; missing/wrong token or session: 401; wrong content type: 415.
  JSON `{error: code}` uses `BAD_REQUEST` (400), `FORBIDDEN` (403), `UNAUTHORIZED`
  (401), `UNSUPPORTED_MEDIA_TYPE` (415), or `SESSION_LIMIT` (429).
- `GET /events` requires the valid cookie; returns `text/event-stream`,
  `Cache-Control: no-store`. Never include credentials in events. No separate
  unauthenticated snapshot route. Keep `/health` public and content-free.

**Proposed SSE and lifecycle contract**

Each event is `event: snapshot\nid: <instanceId>:<revision>\ndata: <JSON>\n\n`,
where JSON is exactly a `DisplaySnapshot`. Ignore Last-Event-ID for recovery:
always send the latest full snapshot. Send `: heartbeat\n\n` every 5 seconds.
Browser retries dropped streams after 1 second, shows reconnecting immediately
on detected loss, and disconnected after 15 seconds without traffic. A rejected
session requests a fresh access URL rather than retrying credentials forever.
Foreground heartbeat silence triggers loss detection within 15 seconds.

Register each subscriber and capture current state in one serialized operation.
Maintain at most one pending latest snapshot per connection beyond the active
write; never enqueue an unbounded event history. Disconnect if a write remains
backpressured for 5 seconds. Cap active SSE connections at 32 (429 on excess).
Revisit scaffold HTTP timeouts for long-lived SSE without weakening other routes.

**Load-bearing rendering boundary**

Use maintained sanitizer libraries with explicit HTML/attribute/CSS allowlists;
strip scripts, event handlers, embeds, frames, objects, forms, SVG, resource URLs,
CSS imports, and navigation attributes. Display anchor text without navigation.
Only safe structural/text HTML and inline layout/typography/color CSS survive.
Reject URL-bearing CSS even when obfuscated; do not implement security via regex.

Render only sanitized output in `iframe srcdoc` with an empty `sandbox` attribute.
No script/same-origin/form/popup/download/top-navigation permissions. Frame CSP:
`default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`.
Apply policy before content is parsed; prevent authored metadata overriding it.
Trusted shell uses local external assets, `default-src 'none'; script-src 'self';
style-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'`; verify srcdoc behavior in real browsers.
Never insert authored markup into shell DOM or give the frame the session secret.

**Optional mechanics:** libraries, module subdivision, bundler, and browser runner
remain open; no framework required. Allowlists/browser evidence are load-bearing.

## Affected code

- Existing `src/server/config.ts`: validated port, exact loopback binding.
- Existing `src/server/http/create-server.ts`: unbound Fastify factory,
  Host/Origin boundary, no-store health response; currently no content routes.
- Existing `src/server/main.ts`: startup, stderr diagnostics, signal shutdown.
- Existing `src/contracts/health.ts` and its test: portable health schema;
  preserve `{"status":"ok","service":"agent-canvas"}` and its content-free purpose.
- Proposed `src/contracts/display.ts`, server `display/`, `security/`, `mcp/`,
  and client `shell/`, `rendering/` follow `docs/architecture.md`. Browser build/tests
  are future work. An approved plan must resolve exact files and own each once.

## Acceptance

All check definitions are **proposed for human review**. `scaffold-types` exists;
`live-core`, `live-security`, and `live-browser` reference future files and are
**not runnable yet**. No check here was run as evidence of live features.
Commands are read-only argv arrays executed without a shell; review underlying
test scripts/oracles before approval. Planner selects these IDs, never edits them.

| Requirement IDs    | Check IDs                   | Required automated evidence                                                                                                          |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| LIVE-001, LIVE-002 | scaffold-types, live-core   | Direct stdio discovery/results; clean stdout; host startup/error/shutdown; status counts.                                            |
| LIVE-003, LIVE-004 | live-core, live-security    | Exact schemas/limits; multibyte boundaries; filtered-empty failure; concurrent mutations; no state change on failure; restart/clear. |
| LIVE-005, LIVE-006 | live-core, live-browser     | Subscribe/mutate race; stale/duplicate/new-instance events; reconnect and clear in multiple tabs without shell reload.               |
| LIVE-007           | live-security, live-browser | Hostile scripts/SVG/forms/frames/links and encoded CSS URLs; no execution, navigation, remote requests, or shell changes.            |
| LIVE-008, LIVE-009 | live-security, live-browser | Host/Origin/token/cookie failures; bootstrap replay within lifetime; restart invalidation; caps; no-store; no logs/storage leaks.    |
| LIVE-010           | live-browser                | Synthetic readable email, missing-header handling, distinct recommendation; no real-message fixtures.                                |
| LIVE-011           | live-core, live-browser     | Bounded pending state/backpressure eviction; heartbeat loss; measured foreground rendering latency.                                  |

Proposed latency procedure: foreground local browser, warm connection, 100 sequential
synthetic updates each at 10 KiB and 512 KiB raw payload, no concurrent load.
Use one test monotonic clock from observed MCP success to animation-frame
confirmation of the revision's rendered text: every sample at most 1000 ms.
Record machine/runtime/browser and median/p95/max; this is not user attention.

**Human-only:** Review supported MCP-host behavior and readability; after automated
security evidence, an operator explicitly permits one real email for this surface.
Record consent/completion without copying email into artifacts. Uncertain permission
means stop at synthetic content; synthetic tests cannot complete this manual step.

## Decisions

- **Blocking approval:** Human review of tool/HTTP/SSE contracts, limits, rendering
  allowlists, session policy, browser/host support matrix, and latency budget.
- **Blocking execution:** Future checks need separately approved preparation and
  human review; never edit them during repairs.
  Select maintained sanitizer/SDK and browser tooling before exposing content.
- Explicit user approval alone changes approval status/metadata. Agent never
  self-approves. `base_commit` is reviewed code; later approved-spec commits are valid.
  Intervening non-spec code/config requires re-grounding. Stop for stale/blocked
  plans or product conflicts. Protected policy/vendor/spec/quality-gate changes
  are separate human-reviewed work, never feature-chain edits.
- After the plan gate: sequential bounded chunks, one fresh reviewer, two repairs
  maximum. Still draft: no live build/paid chain/push/merge; complete specs are historical.
