# Coding and repair obligations

Load this pack plus [product](product.md) and the current chunk's selected
approved spec sections. Do not load unrelated specs or the entire policy set.

- **CODE-001 — Gate first.** Require the validated plan and explicit human spec
  approval. Check the execution baseline plus preceding authorized chunk changes,
  not spec-baseline equality with HEAD. An approved-spec commit after its reviewed
  code baseline is valid; other intervening code/config needs re-grounding.
  Stop for unexpected drift, blocked decisions, or product/spec conflicts.
- **CODE-002 — One bounded chunk.** Execute chunks sequentially. Change only the
  current chunk's exact owned files for its requirement IDs and blueprint.
  Do not borrow another chunk's files or hide supporting scope in a repair.
- **CODE-003 — Preserve intent.** Implement approved outcomes, failure behavior,
  negative cases, and load-bearing design. Optional mechanics are latitude, not
  permission to change contracts, authority, privacy, or acceptance.
- **CODE-004 — Safe increments.** Keep content unreachable until authentication
  and rendering protections exist together. Preserve dependency boundaries,
  runtime validation, clean stdout, and synthetic-only automated fixtures.
- **CODE-005 — Evidence.** Run the chunk's selected reviewed check IDs as exact
  argv arrays without shell interpretation. Record command identity, exit status,
  and relevant evidence. Missing checks, skipped cases, or unavailable tools are
  blockers, never passing results.
- **CODE-006 — No weaker oracle.** Never edit reviewed checks, underlying tests,
  scripts, thresholds, or configuration merely to pass. Do not remove assertions,
  suppress failures, add skips, disable security controls, or bless new snapshots
  as a repair. Legitimate oracle changes require separate human review.
- **CODE-007 — No hidden changes.** No unrelated refactors, dependencies, generated
  churn, persistence, credentials, or infrastructure. Preserve others' work.
  Stop for an amended plan if the necessary fix exceeds ownership or scope.
  Protected build policy, vendor, spec, and quality-gate files are never feature
  chain edit targets; workflow changes require separate human-reviewed work.
- **CODE-008 — Review handoff.** Supply the diff, requirement/check mapping,
  results, limitations, and human-only acceptance still outstanding to one fresh
  independent reviewer. Do not self-certify correctness or approval.
- **CODE-009 — Repairs.** Address concrete reviewer findings within the same
  approved boundaries; document each finding's disposition and rerun affected
  reviewed checks. At most two repair rounds; no reset by spawning another coder,
  widening scope, or relabeling findings.
- **CODE-010 — Stop honestly.** Unresolved findings, conflicts, failing checks,
  unavailable evidence, or exhausted rounds block completion. Report the blocker
  and leave approval/status changes to explicit human authorization.
  Never push or merge.
