# Security

## Current limitations

This is a development scaffold, not a protected content viewer. Its only
application endpoint is a non-sensitive `GET /health` response. The server binds
to IPv4 loopback, validates Host and Origin, does not enable CORS, and disables
request logging.

These controls are not authentication. Before adding any display or draft
endpoint, implement the per-process browser authentication, content isolation,
sanitization, no-store policy, and negative tests described in `SPEC.md`.

Do not add real messages, drafts, credentials, access tokens, or classified
material to fixtures, logs, issues, or commits. A local process is not protection
against malware or other privileged local users.

## Reporting a vulnerability

Do not put sensitive details or exploit payloads containing private data in a
public issue. Use GitHub's private vulnerability reporting for this repository
if enabled. Otherwise ask the repository owner for a private reporting channel
without disclosing the vulnerability publicly.

No support SLA or production security guarantee is offered at this stage.
