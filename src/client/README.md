# Browser boundary

`shell/main.ts` is the trusted, local-only browser entry point. The initial shell
contains no display data. It removes a bootstrap token from the URL fragment
before exchanging it once for an HttpOnly session cookie, or leaves an absent
fragment for the later credentialed stream to reuse an existing cookie. The
completed connection controller supports one fetch SSE stream with bounded
parsing, liveness deadlines, and status-aware reconnects; the later authenticated
SSE route chunk binds it to the shell rather than issuing a premature content
request from this chunk.

Import portable wire schemas from `../contracts/`. Never import server modules,
Node.js APIs, source-system credentials, or a second copy of a wire type.

The browser must not use storage, service workers, telemetry, remote resources,
or application-file content. Trusted title and connection state stay in the shell.
Sanitized display HTML and CSS enter only a freshly constructed `srcdoc` iframe
with an empty sandbox, restrictive nonce-bound CSP, and trusted base typography.
The shell retains the last frame with a stale warning during connection loss and
replaces only that frame for a newer snapshot.
