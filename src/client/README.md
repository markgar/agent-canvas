# Browser boundary

The browser implementation belongs here when the live-display milestone starts.
There is no browser application in the scaffold yet.

Import portable wire schemas from `../contracts/`. Never import server modules,
Node.js APIs, source-system credentials, or a second copy of a wire type.

Add a dedicated DOM-only TypeScript configuration and a browser build when the
first entry point is implemented. Keep trusted shell code separate from
agent-supplied frame content. Do not add an HTML display route before the
authentication, sanitization, sandbox, and CSP requirements in `SPEC.md` are met.
