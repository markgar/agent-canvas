# Independent review and repair verification

Plan review and implementation review load this pack plus [product](product.md)
and the full selected approved feature spec. Plan review additionally loads the
planning pack and inspects the proposed plan; implementation review inspects the
validated assignment, diff, and check evidence.
Completed specs are historical context only, not injected requirements.

- **REV-001 — Fresh independence.** Use one reviewer with fresh context after
  sequential coding, not the implementing agent's self-review. Inspect the
  actual diff and source; implementation claims are not evidence.
- **REV-002 — Gate audit.** Verify explicit human approval, valid baseline,
  satisfied blocking decisions, exact file ownership, and requirement coverage.
  A spec-only approval commit may follow `base_commit`; do not require equality
  with HEAD. Verify re-grounding for intervening non-spec code/config changes and
  distinguish expected planned chunk changes from unexpected drift.
  Any stale plan, hidden scope growth, or product/spec conflict blocks completion
  and requires human resolution where approval or intent must change.
- **REV-003 — Behavioral review.** Check outcomes, load-bearing design, exact
  wire contracts, failure paths, and negative cases. Prioritize authentication,
  hostile rendering, credentials/logs, atomic state, reconnect races, and bounded
  resource use over style preferences.
- **REV-004 — Evidence audit.** Verify selected check IDs exist and correspond to
  the reviewed argv arrays run without a shell. Inspect underlying checks and
  configuration for weakened assertions, skips, threshold changes, or fabricated
  passes. Reviewed checks cannot be edited to make implementation pass.
  Block feature-chain edits to protected build policy, vendor, spec, or quality-gate
  files; workflow changes belong to separate human-reviewed work.
- **REV-005 — Honest acceptance.** Distinguish automated evidence from human-only
  acceptance and proposed/unavailable checks. Never substitute a simulated test
  for real browser isolation evidence or automate real-email consent.
- **REV-006 — Findings.** Report concrete file/line evidence, violated rule or
  requirement IDs, impact, and the smallest in-scope correction. Clearly
  distinguish blockers from optional suggestions; no speculative scope expansion.
- **REV-007 — Read-only authority.** Do not implement fixes, alter specs/checks,
  approve on behalf of a human, or silently reinterpret a product requirement.
  If a check itself is wrong, request human review rather than rewriting it.
- **REV-008 — Repair verification.** Recheck each disposition against the actual
  repaired diff and affected check evidence, including regressions. Reuse this
  independent review role; do not add reviewers to bypass the budget.
  Allow at most two repair rounds total, then report unresolved blockers.
- **REV-009 — Completion.** A recommendation requires all mandatory evidence and
  no unresolved blockers. It is not human approval, permission to mark a draft
  approved, or permission to push/merge. Report remaining human-only acceptance
  explicitly; never claim a complete feature while it remains unmet.
