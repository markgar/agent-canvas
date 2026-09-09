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
  Review newly authored tests together with the capability: require meaningful
  assertions for its assigned requirements, not just a green existing scaffold.
  Explicitly review planned sequential revisits for regression loss. Test support
  must not impose unnecessary product structure or contain a parallel fake
  implementation. A chunk must remain small enough to inspect its code and tests.
- **REV-005 — Honest acceptance.** Distinguish automated evidence from human-only
  acceptance and proposed/unavailable checks. Never substitute a simulated test
  for real browser isolation evidence or automate real-email consent.
- **REV-006 — Findings.** Report concrete file/line evidence, violated rule or
  requirement IDs, impact, and the smallest in-scope correction. Clearly
  distinguish blockers from optional suggestions; omit optional suggestions from
  the blocking artifact and never use speculative scope expansion. Limit plan review
  to five blockers and implementation review to three. Findings must be consequential
  and directly repairable in one pass.
- **REV-007 — Read-only authority.** Do not implement fixes, alter specs/checks,
  approve on behalf of a human, or silently reinterpret a product requirement.
  If a check itself is wrong, request human review rather than rewriting it.
- **REV-008 — One-way repair handoff.** Send the finite blocking finding set directly
  to the original planner or builder lineage for one bounded correction pass. Do not
  semantically re-review the repair or expand the finding set. Deterministic final-plan,
  chunk, and repository gates decide whether corrected work may advance.
- **REV-009 — Completion.** A review recommendation guides the single repair; it is
  not human approval, permission to mark a draft approved, or permission to push or
  merge. Objective gate success still leaves human-only acceptance pending.
