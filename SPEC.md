# Agent Canvas

## Status and decisions

This is a draft specification for review, not an implementation or authorization to deploy infrastructure.

**Confirmed:** Agent Canvas will be written in TypeScript. It is a general-purpose, MCP-driven visual surface that opens in a browser beside an assistant's chat. Updates must appear without reloading the page or reopening the browser. Email is the first use case, not the product's organizing model.

**Proposed baseline:** Node.js, stdio MCP, a local HTTP server, server-sent events (SSE), and a small browser shell with no frontend framework. The server and browser code use TypeScript. The contracts and defaults below are proposals for the initial implementation.

## 1. Purpose

Give an assistant a persistent place to show information that is easier to understand visually than in chat: messages, recommendations, drafts, tables, diagrams, and other HTML-based views.

The assistant chooses what to display. The user continues discussing the content and approving actions in chat.

Agent Canvas owns presentation and, in a later milestone, editable draft state. It does not own the assistant's reasoning, access to source systems, or authority to perform external actions.

### First user experience

1. The assistant starts or connects to Agent Canvas through MCP.
2. The user opens a local browser URL supplied by the assistant.
3. The assistant displays an email and a clearly separate recommendation.
4. The user asks a question or requests a change in chat.
5. The assistant updates the existing browser view through MCP.
6. If the browser connection drops, it reconnects and restores the latest view.

Opening the browser is a host capability or a manual user action. The display server must work without assuming the assistant can launch a browser.

## 2. Scope

### Milestone 1: live, read-only display

- One local server process and one current view per process.
- A persistent browser shell with a title and connection status.
- Agent-supplied HTML and CSS, sanitized and isolated from the shell.
- Whole-view replacement and clearing through MCP.
- Live updates through SSE.
- In-memory retention of the latest view for browser reconnects.
- A synthetic email example, followed by one real email permitted for this use.
- Clear errors for invalid input and unavailable connections.

Multiple tabs may observe the same current view. Separate assistant sessions should launch separate server processes; sharing state between assistants is not part of this milestone.

### Explicitly out of scope

- Email retrieval, sending, deletion, or M365 credentials.
- User-editable replies and other interactive agent-authored forms.
- Agent-supplied JavaScript.
- Named-section updates or DOM patching.
- View history or content recovery after a server restart.
- Multi-user access, remote hosting, or cloud infrastructure.
- Embedded chat, automatic assistant wake-up, or host-specific integration.
- A knowledge service, embeddings, vector search, or a graph database.

These exclusions keep the first implementation focused on proving the live-display experience.

## 3. Architecture

```text
Assistant / MCP host
        |
        | MCP over stdio
        v
Agent Canvas Node.js process
        |
        +-- MCP tools
        +-- Input validation and content sanitization
        +-- In-memory current display state
        +-- Loopback HTTP server
                |
                +-- Trusted browser shell and static assets
                +-- Authenticated SSE snapshot stream
                            |
                            v
                    Persistent browser tab
                            |
                            +-- Trusted title and connection status
                            +-- Sandboxed HTML/CSS content frame
```

The HTTP listener serves the browser, not MCP, in the proposed initial version. Streamable HTTP MCP can be added later if a target assistant host requires it.

Use the official TypeScript MCP SDK rather than implementing the protocol. Use maintained libraries for HTML/CSS sanitization and runtime input validation. TypeScript types alone are not a runtime security boundary.

MCP protocol output is the only output written to stdout. Diagnostic logs go to stderr and must not include displayed content or access tokens.

## 4. Proposed MCP contract

Tool names are provisional. Keep the API about views, not emails.

| Tool                | Input                                          | Result                                                                                                         |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `canvas_get_status` | None                                           | Browser access URL, process instance ID, current revision, whether a view exists, and connected browser count. |
| `canvas_present`    | A title, HTML body fragment, and optional CSS. | Accepted revision and any content-filtering warnings.                                                          |
| `canvas_clear`      | None                                           | Accepted revision for the empty display.                                                                       |

`canvas_present` replaces the entire current view. It does not open a new tab. `canvas_clear` removes the current view but leaves the browser shell connected.

Conceptual shared types:

```ts
interface PresentViewInput {
  title: string;
  html: string;
  css?: string;
}

interface DisplayView {
  title: string;
  html: string;
  css: string;
}

interface DisplaySnapshot {
  instanceId: string;
  revision: number;
  view: DisplayView | null;
}

interface MutationResult {
  instanceId: string;
  revision: number;
  warnings: string[];
}
```

Stored HTML and CSS are the sanitized versions, not the raw request. `title` is plain text and is never interpreted as markup.

Proposed initial limits: 200 characters for a title and 512 KiB of combined UTF-8 HTML/CSS per view. Reject oversized or malformed requests with an actionable MCP tool error, leaving the existing view unchanged.

Sanitization may remove unsupported content. Report the categories removed, such as scripts or external resources, without echoing sensitive input into logs or errors. Do not report an empty, unusable result as successful if filtering removed all meaningful content.

A successful mutation means the server accepted and retained the view, not that a browser has painted it or a user has read it. A connected-browser count is only a connection signal.

## 5. State and live updates

The process starts with a unique instance ID, revision zero, and an empty view. Each accepted mutation increments the revision.

Validate and sanitize a request before changing state. Serialize accepted mutations, replace the current snapshot atomically, and then publish it to connected browsers.

Each SSE `snapshot` event contains a complete `DisplaySnapshot`. Send the current snapshot immediately on every new connection and reconnect, even if the browser supplies a previous event ID. No event history or incremental replay is required.

The connection setup must not leave a gap between sending the initial snapshot and subscribing to later updates. For the same instance ID, the browser ignores older or duplicate revisions. A new instance ID resets its revision comparison.

The browser shell replaces only the content frame when a new view arrives. It does not reload itself or open another window. Intermediate views may be skipped for slow clients; the latest snapshot is authoritative.

Show a visible connected, reconnecting, or disconnected status. While disconnected, retain the last rendered view with a warning that it may be stale. Never imply that it is still receiving updates.

Bound buffering for slow clients and let them reconnect rather than accumulating unlimited pending snapshots.

### Lifetime

State lives only in server memory. Browser reconnects recover the current display while that process is running. Server restarts lose content and invalidate access credentials; the user obtains a fresh URL and the assistant republishes the view.

Clearing removes the server's current view and broadcasts an empty snapshot. It is not a secure-erasure guarantee: a disconnected tab, browser memory, or a screenshot may retain previous content.

## 6. Rendering and local security

Agent-supplied content and source material are untrusted. The trusted shell must not insert supplied HTML into its own DOM.

### Content boundary

- Render sanitized content in a sandboxed iframe without script, same-origin, form, popup, download, or top-navigation permissions.
- Use an explicit allowlist for HTML elements, attributes, and CSS constructs. Remove event handlers, scripts, embedded frames, objects, and active content.
- Apply a restrictive content security policy to the frame. Block network connections, external stylesheets, fonts, images, media, and other remote resources.
- Permit only the inline styling needed for the view. Reject CSS imports and URL-based resource references.
- Disable link navigation in the initial version. Display link text without allowing the frame to navigate.
- Do not support arbitrary SVG or other active embedded formats initially. Simple diagrams can use HTML/CSS; richer diagram rendering is deferred.
- Keep the shell's identity and connection status outside the content frame so supplied styles cannot hide them.

The shell also has its own restrictive CSP and uses locally served assets, with no third-party scripts, fonts, analytics, or CDNs.

### Local access boundary

- Bind to `127.0.0.1`, not all network interfaces, using an available local port.
- Validate `Host` and applicable `Origin` headers. Do not enable permissive CORS.
- Require authenticated access to display state and the SSE stream.
- Generate a high-entropy, per-process access secret. Put bootstrap credentials in a URL fragment rather than a query string, exchange them for an authenticated browser session, and remove the fragment from browser history immediately.
- Use an HttpOnly, SameSite-strict session cookie for same-origin SSE access. Protect the bootstrap endpoint and any later browser mutations against cross-origin requests.
- Serve sensitive responses with `Cache-Control: no-store`. Do not persist content in local storage, service-worker caches, or application files.
- Never log message bodies, draft text, session cookies, or bootstrap secrets.

The access URL is a credential and should not be shared. This boundary protects against unauthorized browser access; it is not a defense against malware or a privileged local user.

### Sensitive source content

Agent Canvas cannot determine whether an email's sensitivity label permits displaying a copy here. The assistant or operator must establish that permission before supplying the content.

For the initial milestone, do not render classified, rights-managed, or otherwise restricted messages unless the handling requirements are understood and this surface is explicitly permitted. If permission is uncertain, use synthetic or non-sensitive content instead.

Memory-only storage and local access do not by themselves make the surface suitable for protected information.

## 7. Email as the first example

The assistant uses its existing authorized email tools to retrieve a permitted message, then constructs a general-purpose view containing:

- Sender, recipients, subject, and date with timezone where known.
- A readable email body, preserving paragraph structure.
- An explicitly labeled "Assistant recommendation" section visually separate from the original message.

Do not invent missing headers or silently present an assistant summary as the original body. Prefer escaped plain text for the first example. If HTML is used, sanitize it and block all remote resources, including tracking pixels.

The assistant may change the message or its recommendation by submitting a complete replacement view. No email-specific server model or tool is required.

## 8. Milestone 2: reply editing

This is a later extension, not part of the first implementation.

Use a trusted reply editor owned by the browser shell rather than enabling arbitrary scripts inside agent HTML.

The browser saves draft state to the local server and shows whether edits are saved, pending, or failed. The assistant retrieves the latest saved draft through MCP. Drafts need stable IDs and revisions so view replacement or concurrent assistant updates cannot silently overwrite unsaved user edits.

Before sending, the assistant obtains the current saved draft, previews the exact recipients and content in chat, and requests confirmation. Confirmation applies to that specific draft revision and recipient set. Later changes require a new preview and confirmation.

The assistant sends through its existing authorized email tools. Agent Canvas holds no email credentials and never sends mail itself.

A browser interaction does not automatically wake the assistant or create a chat turn. Any such behavior requires a separate, explicit host integration.

## 9. Acceptance criteria for milestone 1

1. A supported MCP host can start the TypeScript/Node.js process over stdio and discover its tools.
2. The supplied access URL opens an authenticated browser shell with an empty state.
3. `canvas_present` displays an email example with readable headers, body, and a distinct recommendation.
4. A second call changes the existing display without reloading the shell or opening another tab.
5. Under normal local conditions, an accepted update appears within one second in a connected foreground browser tab.
6. Closing and reopening the browser connection restores the latest snapshot while the process remains alive.
7. `canvas_clear` returns connected tabs to the empty state; reconnecting tabs also see that state.
8. Invalid or oversized requests leave the last accepted display intact and return useful errors.
9. Script, navigation, tracking-image, CSS-resource, and iframe payloads cannot execute active content or produce remote requests.
10. Unauthenticated clients and requests with disallowed hosts or origins cannot read display state or mutate browser session state.
11. Connection loss is visible, and a slow client cannot cause unbounded server buffering.
12. Restarting the server produces an empty state and invalidates previous access credentials.
13. The demonstration progresses from synthetic content to one real email explicitly permitted for this display.

Use focused unit tests for validation, state transitions, and sanitization; integration tests for MCP and HTTP access; and browser tests for live updates, reconnects, and content isolation.

## 10. Implementation sequence

1. Establish the TypeScript project, shared contracts, and an in-memory state store.
2. Add stdio MCP tools and the authenticated local HTTP shell.
3. Add sanitized frame rendering and SSE snapshot delivery.
4. Demonstrate replacement, clearing, reconnects, and security boundaries with synthetic content.
5. Display one permitted real email through the assistant's existing tools.

Keep each step small enough to explain and inspect. Do not add a database, general component framework, or knowledge-service dependency to complete this sequence.
