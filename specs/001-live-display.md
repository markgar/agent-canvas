---
id: 001-live-display
title: Live read-only display
status: draft
base_commit: 3ec67b0bdc73c60c47d211033036b67f6ffdffbf
approved_by: null
approved_at: null
checks:
  - id: scaffold-types
    command: [npm, run, typecheck]
  - id: feature-tests
    command: [npm, test]
---

## Outcome

A persistent browser surface beside chat receives MCP replacement/clear updates
and reconnects to the latest view. Email with a separate recommendation demonstrates
a general-purpose surface, not an email application.

Agent Canvas is a standalone MCP server and ordinary browser application for an
assistant that has no built-in visual surface. It is not a canvas extension for
the app used to develop it. The consuming agent needs only a stdio-capable MCP
host; it must not need this development app's canvas tools, extension APIs, skill
system, side panels, or session orchestration.

Milestone 1 of `SPEC.md`; frontmatter records approval, not execution consent.
Only the TypeScript/Node.js/Fastify/Zod scaffold and loopback health server exist;
MCP, auth, rendering, and SSE contracts below are proposed behavior, not implemented
capabilities. The baseline above is the inspected scaffold and build-system commit.
The review choices recorded below do not approve execution.

## Scope

Include one process/current view, observing tabs, stdio MCP, a public content-free
shell with authenticated display access, sanitized HTML/CSS, replacement/clear,
SSE, memory-only recovery, synthetic and
separately consented real-email demonstrations. Browser opening is manual or a
host capability. Separate assistant sessions launch separate processes.

Exclude email credentials/retrieval/actions, editing/forms, supplied JavaScript,
DOM patching, history/persistence, remote hosting, multi-user sharing, infrastructure,
embedded chat, assistant wake-up, host-specific integration, and knowledge services.
No real email is supplied to the scaffold or automated validation.

The initial end-to-end support target is macOS, GitHub Copilot CLI as the MCP host,
and Chromium-based Chrome/Edge. Automated browser acceptance uses a pinned
Playwright Chromium build; manual smoke acceptance covers both Chrome and Edge
and records their versions, the macOS version, and the Copilot CLI version.
An official MCP SDK client supplies automated protocol evidence, not a substitute
for the actual host. Copilot CLI is a compatibility target, not a runtime
dependency or a requirement that the consuming agent have native canvas support.
All interaction uses standard MCP tool discovery/calls and an ordinary browser;
manual URL opening must work when the consuming agent cannot open a browser.
Retain the repository's Node.js 22.14+ (22.x) and 24.x support;
run core/protocol acceptance on both. Firefox, WebKit/Safari, other MCP hosts, and
Windows/Linux end-to-end behavior are unverified, not promised by this milestone.

Governance: [product](../.chainkit/governance/product.md), [planning](../.chainkit/governance/planning.md), [coding](../.chainkit/governance/coding.md), [reviewing](../.chainkit/governance/reviewing.md).

## Requirements

- **LIVE-001:** A supported host launches the compiled process directly over stdio
  and discovers the three tools below. HTTP serves only the browser, not MCP.
  Only protocol output reaches stdout; startup/transport failure is actionable
  on stderr without content or credentials. SIGINT, SIGTERM, or MCP stdin EOF
  closes HTTP/SSE and MCP and exits within five seconds without orphan listeners.
- **LIVE-002:** Status supplies a credential-bearing browser URL, instance ID,
  revision, view presence, and authenticated SSE connection count, not a count of
  unique people or tabs. Manual opening works. Never interpret connections or
  accepted mutations as paint/read receipts.
- **LIVE-003:** Validate and sanitize before mutation. Enforce the exact schemas
  and limits below; invalid, oversized, or text-empty sanitized input returns
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
- **LIVE-011:** Under the foreground local measurement below, accepted
  updates become visible within one second. Connection loss is visible within
  15 seconds; slow observers cannot cause unlimited server pending snapshots.

## Design

### MCP and state contracts

Use official TypeScript MCP SDK stdio and portable runtime schemas with inferred
types. Input objects reject unknown keys. No-argument tool inputs are `{}`.
Expose exactly `canvas_get_status`, `canvas_present`, and `canvas_clear` with their
input schemas through tool discovery. HTTP must be listening before MCP status
can return a usable URL; startup failure must not leave a partially live process.

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

For known tools, argument validation failures use the domain failure shape above,
even if SDK default validation would otherwise return a protocol error. Protocol
errors and diagnostics must not reflect unknown tool names, arguments, or raw
messages. `UNAVAILABLE` also covers shutdown or an internal processing failure;
use a fixed safe message, preserve state, and do not report partial acceptance.

Title is plain text with at least one character remaining after ECMAScript
`trim()`, at most 200 Unicode code points, and is otherwise preserved. HTML is a string;
CSS is an optional string defaulting to `""`. Combined raw HTML/CSS UTF-8 size
must be at most 524288 bytes, inclusive, before sanitization. Size overflow
uses `TOO_LARGE`, malformed/schema input `INVALID_INPUT`, and sanitized content
without non-whitespace body text `EMPTY_CONTENT` (even if title is present).
Check schema first, then raw size, sanitization, normalized size, and text presence.
Text presence means a retained decoded body text node is nonempty after
ECMAScript `trim()`; comments, attributes, styles, title, and removed script text
do not count. It is not a promise that arbitrary permitted styling is legible.
Normalization may expand output: the retained HTML/CSS combined UTF-8 limit is
1048576 bytes, inclusive; exceeding it also returns `TOO_LARGE` without mutation.
Warnings are deduplicated category strings from `active-content`,
`external-resource`, `navigation`, `unsupported-markup`, `unsupported-css`;
return them in that order, never fragments of input. Clear returns `warnings: []`.
Classify removals as follows: executable/embedded/interactive elements and event
handlers are `active-content`; resource attributes and URL/import CSS are
`external-resource`; anchors' navigation attributes are `navigation`; other
removed elements/attributes are `unsupported-markup`; other rejected CSS is
`unsupported-css`. A removed subtree may produce multiple categories.
Safe style normalization itself is not a warning.

Serialize complete accepted mutations, including validation/sanitization, in the
order complete tool calls enter the application operation. Rejected calls do not
advance revision. Publishing must not wait for a browser write or acknowledgement;
one slow observer cannot block tool completion or other observers.
After retention, a delivery failure closes the affected stream rather than turning
an already accepted mutation into a tool error or rolling back its revision.

### Browser access and sessions

- Browser URL: `http://127.0.0.1:<port>/#token=<base64url-secret>`, using 32 random
  bytes per process. Root/assets are public but carry no display data or secrets.
  On initialization the shell reads the fragment into memory, removes it with
  history replacement before bootstrap/stream requests, then exchanges it and
  discards its copy.
  Never send it in a request URL or persist it. Without a fragment, attempt the
  existing cookie session directly. An invalid supplied token must not silently
  fall back to a cookie and claim successful bootstrap.
- `POST /session`, JSON `{token: string}` only, requires
  `Content-Type: application/json` (optional UTF-8 charset) and exact Origin
  `http://127.0.0.1:<port>`. Bound the request body at 1024 bytes.
  Compare secret safely; valid exchange returns 204 with no body and an opaque
  32-random-byte session cookie:
  `agent_canvas_session_<port>=<value>; HttpOnly; SameSite=Strict; Path=/`.
  Cookie names include the bound port because cookies do not isolate by port.
  Cookie is host-only and session-only; no Secure attribute on this HTTP-only
  loopback proposal. Credentials are invalid outside their generating process.
- Bootstrap secret remains valid for opening further tabs during that process.
  A valid token plus a valid cookie reuses that session without allocating a
  record or rotating the cookie. Without a valid cookie, a valid token creates
  a session. Cap live records at 32; prune expired records before allocation and
  return 429 `SESSION_LIMIT` only when a new record would exceed the cap.
  Reuse still succeeds at the cap. No browser mutation endpoint beyond bootstrap.
- A session expires after 24 hours with no active SSE connection and no successful
  authenticated activity. Session creation, bootstrap reuse, an accepted stream
  connection, and closure of its last stream start/reset the idle clock; unauthenticated requests
  do not. Use elapsed time, not a wall-clock adjustment, for expiry. Active streams
  keep a session live, but stalled streams are subject to backpressure eviction.
  Expired cookies require a new access-URL exchange; no logout/refresh endpoint.
- Validate exact Host with the bound port on all routes; reject any supplied
  nonmatching Origin. Missing Origin is allowed for GET, never for bootstrap.
  No CORS opt-in, forwarded-authority trust, or redirects. Reject disallowed
  Host/Origin before parsing/authentication. For bootstrap, check media type and
  body size before parsing. Malformed JSON, non-object body, extra fields, or
  non-string token: 400 `BAD_REQUEST`. An object with no token, or a wrong string
  token (including empty), is 401 `UNAUTHORIZED`. This exception to required-field
  validation makes the missing-token behavior unambiguous.
- HTTP errors have JSON `{error: code}`, no reflected request data:
  `BAD_REQUEST` (400), `FORBIDDEN` (403), `UNAUTHORIZED` (401),
  `BODY_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `SESSION_LIMIT` (429),
  `CONNECTION_LIMIT` (429), `NOT_FOUND` (404), or `UNAVAILABLE` (503).
  Unregistered route/method pairs return 404; do not add implicit mutation routes.
  Missing/invalid/expired stream cookies return 401 before capacity checks;
  an internal failure before streaming returns 503. Once streaming, close on
  failure rather than appending JSON or diagnostic text to an event.
- `GET /events` requires the valid cookie; returns `text/event-stream`,
  without response compression or proxy buffering. Never include credentials in
  events. No separate snapshot route. Keep `/health` public and content-free.
  Every response, including public shell/assets and failures, uses
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and
  `Referrer-Policy: no-referrer`. Assets have explicit correct MIME types.

Cookies are not isolated by port: the port-specific name prevents accidental
session collisions, not disclosure to a malicious local HTTP service. This design
does not defend against hostile local processes, malware, or a privileged user.

### SSE and browser lifecycle

Each event is `event: snapshot\nid: <instanceId>:<revision>\ndata: <JSON>\n\n`,
where JSON is exactly a `DisplaySnapshot`. Ignore Last-Event-ID for recovery:
always send the latest full snapshot as the first event. Send
`event: heartbeat\ndata: {}\n\n` every five seconds while writable, without an `id`;
heartbeats do not mutate state or imply a new revision. Comments alone are not
heartbeat evidence because native EventSource does not expose them to listeners.

Use a same-origin credentialed fetch stream with SSE framing so the shell can
observe HTTP status and heartbeat events. Decode UTF-8 across byte boundaries,
handle partial/coalesced frames, and validate snapshots before applying them.
Reject a heartbeat before the first snapshot, a heartbeat with data other than
`{}`, a snapshot ID inconsistent with its payload, and unknown event types as
protocol errors. Comments do not count as liveness evidence.
Keep at most 8 MiB of undecoded/partial event data; exceeding the cap or receiving
an invalid snapshot aborts the stream with a content-free protocol-error message.
The bound accommodates JSON escaping of a maximum-size normalized view.
Do not insert a partial or invalid snapshot into the frame.

The shell starts reconnecting and becomes connected only after a valid snapshot.
Network/EOF/protocol failure immediately marks the last view stale and retries
one second after failure. Show reconnecting until 15 seconds since the last valid
snapshot/heartbeat, then disconnected while one-at-a-time retries continue.
Until the first valid snapshot, measure that status deadline from the initial
connection attempt; failed retries must not reset it.

Separately, abort each connection attempt if its first snapshot has not arrived
within 15 seconds, or an established stream after 15 seconds without a valid
snapshot/heartbeat. This per-attempt timeout allows recovery attempts even while
status remains disconnected. Heartbeats alone cannot establish a connection.
Cancel superseded streams and ignore their callbacks so an old connection cannot
overwrite new state.
401/403 stops automatic retries, marks the view stale/disconnected, and displays an access-expired/denied message
requesting a fresh URL from the assistant. A 429 or 503 retries after one second.
Other HTTP failures stop with an actionable content-free error. Bootstrap has a
15-second timeout; failure surfaces its error instead of silently showing an authenticated state.
Never retry the bootstrap secret indefinitely.

An instance change resets revision comparison; for the same instance, only a
strictly newer revision replaces the view. A valid duplicate initial snapshot
still confirms a reconnected stream without repainting. Null view clears the
title/content to a trusted empty state. Only the content frame and trusted title
change on a new view; the shell document, URL, and tab do not reload.
Foreground timing is required; background-tab throttling is not a failure.
On returning to the foreground after 15 seconds without a heartbeat/snapshot,
mark the view stale and reconnect immediately rather than imply live delivery.

Register each subscriber and capture current state in one serialized operation.
Maintain at most one pending latest snapshot per connection beyond the active
write; never enqueue an unbounded event history or heartbeat backlog. Do not issue
another write after backpressure until drain; skip heartbeats during that wait.
Disconnect if a write remains backpressured for five seconds. Cap active SSE
connections globally at 32 (429 `CONNECTION_LIMIT` on excess). Count accepted live
streams, including multiple streams sharing a cookie; release the slot on closure.
Revisit scaffold HTTP timeouts for long-lived SSE without weakening other routes.

### Rendering allowlist and isolation

Use maintained HTML sanitization and CSS parsing/validation libraries. Parse before
filtering, including entity/escape decoding; do not implement security via regex
or accept a library's broader default allowlist. The supported subset is:

| Input                   | Retained subset                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML elements           | `div`, `span`, `p`, `br`, `hr`, `h1`-`h6`, `strong`, `b`, `em`, `i`, `u`, `s`, `small`, `sub`, `sup`, `blockquote`, `pre`, `code`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, `section`, `article`, `header`, `footer`, `main`                                                                                                    |
| Global input attributes | `class`, `title`, `lang`, `dir`, `style`; `dir` is `ltr`, `rtl`, or `auto`; classes are whitespace-separated ASCII identifier tokens; language tags are valid BCP 47 tags                                                                                                                                                                                                                   |
| Table attributes        | `colspan`/`rowspan` on cells: integers 1-100; `scope` on `th`: `row`, `col`, `rowgroup`, `colgroup`                                                                                                                                                                                                                                                                                         |
| CSS selectors           | Lists of element/class/universal selectors, compound element/class selectors, and descendant/child combinators; only allowed HTML elements. No IDs, attribute selectors, pseudo-classes/elements, or sibling combinators                                                                                                                                                                    |
| Text/color CSS          | `color`, `background-color`, `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `letter-spacing`, `word-spacing`, `text-align`, `text-decoration-line`, `text-decoration-color`, `text-decoration-style`, `text-transform`, `white-space`, `overflow-wrap`, `word-break`, `vertical-align`                                                                             |
| Box/table CSS           | `margin`/`padding` and their four physical sides, `border` and its physical-side/width/style/color longhands and shorthands, `border-radius`, `width`, `min-width`, `max-width`, `height`, `min-height`, `max-height`, `box-sizing`, `border-collapse`, `border-spacing`, `table-layout`, `list-style-type`, `list-style-position`                                                          |
| Flex CSS                | `display` restricted to `block`, `inline`, `inline-block`, `flex`, `inline-flex`, `table`, `table-row-group`, `table-header-group`, `table-footer-group`, `table-row`, `table-cell`, `table-caption`, `list-item`; `flex-direction`, `flex-wrap`, `flex-grow`, `flex-shrink`, `flex-basis`, `justify-content`, `align-items`, `align-content`, `align-self`, `gap`, `row-gap`, `column-gap` |

Drop `script`, `style`, `template`, `noscript`, `iframe`, `object`, `embed`, form
controls/forms, `svg`, `math`, and media subtrees including their text. Drop
resource/metadata elements such as `img`, `link`, `meta`, and `base`. Unwrap anchors
and other unlisted structural elements, retaining only recursively sanitized
children. Strip all unlisted attributes, including event handlers, URLs, `id`,
`nonce`, `srcdoc`, and `data-*`; none may authorize styles or influence shell DOM.

CSS is ordinary qualified rules in the `css` field and declaration lists in
input `style` attributes. No at-rules, custom properties, `!important`, CSS nesting,
URLs, images, positioning, floats, transforms, animation, transitions, or generated
content. Values must match the property's standard grammar after decoding.
Permit only finite numbers, standard property keywords, hex/named colors, and
dimensions in `px`, `em`, `rem`, `%`, `vw`, `vh`; the only functions are
`rgb`, `rgba`, `hsl`, and `hsla`. No `var`, `env`, `attr`, `url`, or other functions,
including escaped spellings. `font-family` accepts only lists of generic families
`serif`, `sans-serif`, `monospace`, `system-ui`; no custom/downloaded fonts.
For every allowed property, the CSS-wide values `inherit`, `initial`, and `unset`
are also permitted; other CSS-wide keywords are not.
Remove an invalid declaration as a unit, a rule with an unsupported selector as
a unit, and an at-rule with its subtree. Keep unrelated valid declarations/rules.
If parsing cannot isolate valid rules/declarations, discard that entire stylesheet
or style attribute with `unsupported-css`; never pass unparsed input through.

Normalize safe style attributes into CSS rules with generated per-element IDs,
then remove every style attribute from stored HTML. Authored IDs/ID selectors are
not allowed; generated IDs are unique within the view. Append these generated
rules after sanitized field CSS so inline declarations retain precedence.
`DisplayView.html` and `.css` contain this normalized, sanitized representation,
never a nonce, bootstrap token, or complete frame document.

For each shell document generate a fresh unpredictable style nonce (at least 128
random bits). The shell response CSP is
`default-src 'none'; script-src 'self'; style-src 'self' 'nonce-<nonce>';
style-src-attr 'none'; connect-src 'self'; frame-src 'self'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'`. Use external local shell JS/CSS.
The shell constructs a new `iframe srcdoc` with an empty `sandbox` attribute.
There are no script/same-origin/form/popup/download/top-navigation permissions.
Place trusted metadata first, with frame CSP
`default-src 'none'; style-src 'nonce-<nonce>'; style-src-attr 'none';
base-uri 'none'; form-action 'none'`, followed by a nonce-authorized style element
and sanitized body. Both inherited and frame CSP must permit that style element;
a looser frame policy cannot override a stricter inherited shell policy.
Serialize CSS so it cannot terminate the style element or inject markup.
The nonce comes only from the trusted shell, never from a mutation or snapshot.

Use a trusted minimal frame stylesheet for readable default typography, body
spacing, and text wrapping, before the supplied sanitized rules. The frame remains
inside a bounded shell content region with its own scrolling; long content must
not cover or displace trusted identity/status. Verify legitimate styling actually
renders as well as malicious styling being blocked. Never insert authored markup
into shell DOM or give the frame the session secret.

### Implementation discretion

Library selection within the maintained-library requirement, internal module
subdivision are implementation choices, not unresolved
product behavior. Playwright Chromium and official SDK stdio are the selected
acceptance/protocol technologies. The shared build uses esbuild and the browser
entry `src/client/shell/main.ts`; other internal module paths are not prescribed.
No frontend framework is needed. MCP/sanitizer dependencies can be added with the
relevant implementation chunk without broadening scope or changing wire behavior.

## Affected code

- Existing `src/server/config.ts`: validated port, exact loopback binding.
- Existing `src/server/http/create-server.ts`: unbound Fastify factory,
  Host/Origin boundary, no-store health response, 16 KiB body limit and 10-second
  HTTP timeouts; currently no content routes. Its free-text Host/Origin errors
  change to the codes above; health's successful response stays unchanged.
- Existing `src/server/main.ts`: startup, stderr diagnostics, signal shutdown.
- Existing `src/contracts/health.ts` and its test: portable health schema;
  preserve `{"status":"ok","service":"agent-canvas"}` and its content-free purpose.
- Proposed `src/contracts/display.ts`, server `display/`, `security/`, `mcp/`,
  and client `shell/`, `rendering/` follow `docs/architecture.md`. Browser application
  and feature tests are future work. The plan resolves exact files, including any
  explicit sequential revisits.
- Existing `package.json`, `tsconfig.json`, `tsconfig.build.json`, and
  `vitest.config.ts`: shared scaffold/test configuration. `tsconfig.server.json`
  and `tsconfig.client.json` enforce production runtime boundaries independently
  of the mixed test program. `scripts/build.mjs` compiles server/contracts and
  bundles the browser entry when present. Pinned esbuild/Playwright tooling exists,
  but no feature test harness, MCP/sanitizer implementation, or browser UI exists.
  Existing npm scripts and protected quality-gate files cannot be changed by it.
- Existing colocated HTTP/config/contract tests and `tests/integration/` cover the
  scaffold. `feature-tests` discovers new tests written with each capability; its
  existing scaffold results do not prove live behavior. Update README/architecture
  documentation with implementation, without rewriting approved acceptance tests.

## Acceptance

This is the **chain-only input**: no prewritten feature suite or test adapter is
supplied. The declared `scaffold-types` and `feature-tests` runners already exist.
The planner assigns focused implementation tests, integration cases, and narrow
fixtures alongside their capabilities in context-sized chunks. It must not write
all tests or a whole application-shaped harness before the first capability.

The host builds current artifacts, typechecks, and runs existing regressions at
each chunk. The independent reviewer requires concrete new assertions for every
assigned requirement; green scaffold-only output does not satisfy this table.
Run real browser cases when the shell and safety boundaries exist. Do not commit
placeholder/skipped future cases, weaken accepted assertions, or grade mock
implementations as the product. Final acceptance covers the complete table.

Check commands run read-only, without installs or rebuilding outputs. The host's
separate build step provides current compiled artifacts before measurement.
Actual MCP/HTTP/browser integration must exercise those outputs. Keep assertions
and reports free of credentials/content; all fixtures are synthetic. Browser
temporary profiles/cache belong outside the repository and must be cleaned up.
Each invoked check has the host's two-minute budget; structure tests so unrelated
setup does not consume timing evidence. A timeout is a failure, not permission
to lower sample counts or omit obligations. Do not run latency evidence while
another build or foreground browser measurement competes on the same machine.

| Requirement IDs    | Check IDs                     | Required automated evidence                                                                                                                                                                                                              |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIVE-001, LIVE-002 | scaffold-types, feature-tests | Launch actual compiled entry point via official SDK client; exactly three tools and result/error envelopes; clean stdout and safe stderr; startup failure, stdin EOF/signals, and stream counts.                                         |
| LIVE-003, LIVE-004 | feature-tests                 | Unknown keys/types, blank/200/201-code-point titles, raw and normalized byte boundaries, multibyte input, text-empty failure, warning order, serial concurrent calls, overflow, no state change on failure, restart/clear.               |
| LIVE-005, LIVE-006 | feature-tests                 | Subscribe/mutate race; UTF-8/SSE framing and size bounds; stale/duplicate/new-instance events; heartbeat/status handling; multi-tab reconnect/clear without shell reload; terminal 401/403 and retryable 429/503.                        |
| LIVE-007           | feature-tests                 | Allowlist positive/negative cases; hostile scripts/SVG/forms/frames/links, encoded CSS URLs and style breakout; no execution/navigation/remote requests/shell changes; nonce/CSP styling works, including inline precedence.             |
| LIVE-008, LIVE-009 | feature-tests                 | Exact Host/Origin and error precedence; body/media limits; token/cookie failures, bootstrap reuse at cap, 24-hour idle expiry, active sessions, restart invalidation, global stream cap, no-store and no application logs/storage leaks. |
| LIVE-010           | feature-tests                 | Synthetic readable email, missing-header handling, distinct recommendation; no real-message fixtures.                                                                                                                                    |
| LIVE-011           | feature-tests                 | Bounded pending state/backpressure eviction and count cleanup; silent-stream loss within 15 seconds; per-size foreground rendering latency.                                                                                              |

Latency procedure: macOS, one foreground Playwright Chromium tab, warm authenticated
connection, no concurrent load. For each payload size, send 100 sequential synthetic
updates at its exact raw HTML-plus-CSS byte size (10 KiB or 512 KiB), including a
unique visible revision marker. Await visibility before sending the next update;
do not silently coalesce samples. Use real text/layout fixtures, not padding that
sanitization removes. Run both sizes on both supported Node.js majors.

Use the test runner's monotonic clock for both observations: receipt of MCP success
and completion of a browser-automation observation that the expected marker is
visible in the attached frame after an animation frame. Automation may inspect the
sandboxed frame; production shell code may not access its DOM. If rendering is
observed before the MCP response arrives, record zero post-acceptance delay.
Every sample must be at most 1000 ms; report all failures, sample counts,
machine/OS/runtime/browser versions, and median/p95/max. This measures observed
foreground rendering, not physical screen scanout or user attention.
Keep the browser foreground during loss-timing checks as well; idle-session
expiry and revision overflow may use injected clocks/state in non-browser tests.

Component tests may inject a monotonic clock/state seed, controlled writers and
scheduling barriers, or sanitizer output/failure into actual production logic.
They prove revision overflow, exact idle expiry, atomic subscription/serialization,
one-pending-snapshot/backpressure behavior, and safe processing failures.
The exact normalized 1 MiB boundary uses controlled sanitizer output because
generated-ID serialization is not a fixed raw-input contract; actual sanitizer
integration and expansion cases remain mandatory separately.
No particular test adapter, factory interface, or internal file organization is
required. Helpers must call real production operations, observe actual state, and
release resources; review their bindings rather than trusting structural types.
No production debug endpoint, test-only MCP/IPC protocol, global test API, or
environment-triggered access bypass is permitted. Independent actual compiled-
process, HTTP, and browser evidence remains mandatory and cannot be replaced by
these component scenarios or by harness self-tests.

**Human-only:** In GitHub Copilot CLI on macOS, launch the compiled process directly
(not via `npm start`), discover the tools, and manually open the URL in Chrome and
Edge. Exercise empty state, synthetic present/replace/clear, second tab, reload
without a fragment, connection loss/recovery, and restart requiring fresh access.
Confirm readable source headers/body and a distinct "Assistant recommendation",
trusted status always visible, and no false implication that a stale view is live.
Record tested versions and outcomes. Automated Chromium evidence does not itself
certify the branded browsers or actual MCP host.

After automated security evidence, an operator explicitly permits one real email for this surface.
Record consent/completion without copying email into artifacts. Uncertain permission
means stop at synthetic content; synthetic tests cannot complete this manual step.

## Decisions

- **Resolved review choices (2026-09-08):** macOS end-to-end acceptance; GitHub
  Copilot CLI host; Chrome/Edge with pinned Playwright Chromium evidence; bounded
  text/table/flex HTML/CSS subset; both CSS-field and inline styles normalized into
  nonce-authorized rules; cookie reuse and 24-hour idle expiry. These choices
  resolve the previous support, rendering, and session questions, not approval.
- **Chain-only experiment input:** use shared build/runtime tooling and write
  feature tests with each implementation chunk. Do not import a prepared suite,
  another variant's test ports, or its conversation into this checkout.
- **Contract clarifications in this draft:** public shell versus authenticated
  content, named observable heartbeats with status-aware fetch streaming,
  inherited CSP compatibility, exact error precedence and limits, and automated
  versus human evidence are specified above rather than left to a planner.
  Library/module choices remain bounded implementation discretion.
- **Approval and launch remain separate:** record an inspected code baseline
  and explicit human approval of this contract. No additional full-feature test
  preparation is required for this variant. Missing shared runners or required
  runtime tools remain blockers, not permission to fabricate evidence.
- Explicit user approval alone changes approval status/metadata. Agent never
  self-approves. `base_commit` is reviewed code; later approved-spec commits are valid.
  Intervening non-spec code/config requires re-grounding. Stop for stale/blocked
  plans or product conflicts. Protected policy/vendor/spec/quality-gate changes
  are separate human-reviewed work, never feature-chain edits.
- After the plan gate: sequential bounded chunks, one fresh reviewer, two repairs
  maximum. Still draft: no live build/paid chain/push/merge; complete specs are historical.
