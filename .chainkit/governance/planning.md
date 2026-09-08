# Planning obligations

Planning loads this pack plus [product](product.md) and the full selected approved
feature spec. Plan review additionally loads [reviewing](reviewing.md).
Coding gets product/coding rules and its chunk's selected sections.
Do not inject completed historical specs or unrelated stage packs.

- **PLAN-001 — Approval gate.** Only an explicitly human-approved spec may produce
  an executable plan. Drafts are review material; agents never self-approve.
  Require a full `base_commit`, approval attribution/time, and reviewed check
  registry. Approval of tooling is not approval of product implementation.
- **PLAN-002 — Grounding.** Inspect actual paths and current HEAD. Ground the
  proposed diff against the spec's reviewed code `base_commit` and HEAD; record
  the execution baseline. They need not be equal: committing the approved spec
  after its code baseline is valid. Before planning, inspect intervening commits
  and worktree changes; non-spec code/config changes require re-grounding and
  human review, not silent rebasing. Stop for stale assumptions or blocked decisions.
- **PLAN-003 — Exact ownership.** Produce sequential bounded chunks with
  `id`, `title`, `files`, `specRefs`, `requirementIds`, `checkIds`, and `blueprint`.
  Each `files` entry is an exact repository-relative path owned by the active
  chunk. A later sequential chunk may explicitly list the same file again;
  review that dependency and preserve earlier accepted behavior. No globs,
  duplicate paths within a chunk, concurrent owners, or unlisted edits.
- **PLAN-004 — Traceability.** `specRefs` contains literal section names, such as
  `Requirements` or `Design` (not paraphrases or Markdown `##` markers).
  Reference existing requirement IDs; `checkIds` selects approved argv checks only.
  The blueprint states intended behavior, boundaries, failure handling, and
  evidence, not a second speculative feature spec.
- **PLAN-005 — Bounded scope.** Include tests and directly related documentation
  in the file inventory. No hidden scope growth, drive-by refactors, speculative
  abstractions, installs, or infrastructure. If a required change exceeds the
  approved scope, stop and request a human-reviewed amendment.
  Never assign protected build policy, vendor, spec, or quality-gate files to
  feature chunks; workflow changes require separate human-reviewed work.
- **PLAN-006 — Design fidelity.** Preserve load-bearing design and wire contracts;
  choose optional mechanics only where the spec explicitly leaves latitude.
  Product/spec conflicts require human resolution, not planner interpretation.
- **PLAN-007 — Checks and incremental tests.** Check commands are human-reviewed
  argv arrays, selected by ID. Their runners must exist before execution.
  New feature assertions, fixtures, and narrow test helpers may be authored with
  the capability in its assigned chunk; they need not all precede planning.
  Map each requirement to concrete tests in that chunk and explain which evidence
  needs later integration. Never count missing, unmatched, or skipped cases as a
  pass, or use scaffold-only success as proof of feature behavior.
  Existing accepted tests, runners, and thresholds must not be weakened to pass.
  Review new assertions with implementation before accepting the chunk.
- **PLAN-008 — Validation gate.** Validate references, ownership, current baseline,
  and prerequisite readiness before any coding. Recheck before executing an
  approved plan; an invalid or stale plan performs no writes.
- **PLAN-009 — Execution budget.** Review the plan once, apply its bounded findings
  once in the original planner lineage, then lock the deterministically valid result.
  Execute one chunk at a time with one fresh independent review and one direct repair
  pass under the same boundaries.
  Each chunk must cover a cohesive, reviewable capability and its tests, with
  relevant context only. Reject whole-feature "write all tests" assignments and
  unrelated work bundled to fit the eight-chunk ceiling. If the feature cannot
  fit in context-sized chunks, stop for a smaller feature contract.
  Objective post-repair failure means stop, not more reviewers or retries.
  No push, merge, or automatic approval.
