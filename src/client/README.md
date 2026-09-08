# Browser boundary

`shell/main.ts` is the trusted, local-only browser entry point. The initial shell
contains no display data. It removes a bootstrap token from the URL fragment
before exchanging it once for an HttpOnly session cookie, or leaves an absent
token for the authenticated stream connection to reuse in a later chunk.

Import portable wire schemas from `../contracts/`. Never import server modules,
Node.js APIs, source-system credentials, or a second copy of a wire type.

The browser must not use storage, service workers, telemetry, remote resources,
or application-file content. Keep trusted shell code separate from future
agent-supplied frame content; supplied markup must never enter the shell DOM.
