---
id: feature-template
title: Feature title
status: draft
base_commit: ba83a0898223c36579ed2da605cda12f91ad267a
approved_by: null
approved_at: null
checks: []
---

## Outcome

Describe the observable user result and why it matters. This is a draft, not
implementation permission. Copy to one feature file; replace the ID, title, and
baseline with the actual full HEAD at drafting time.

## Scope

State what is included and explicitly excluded. Distinguish implemented behavior
from proposed additions. Completed feature specs are historical and are not
injected as active instructions.

## Requirements

- **FEATURE-001:** One testable obligation with observable success, failure,
  and negative cases. Keep IDs stable when revising.

Follow [product](../.chainkit/governance/product.md) and the stage-specific
[planning](../.chainkit/governance/planning.md),
[coding](../.chainkit/governance/coding.md), and
[reviewing](../.chainkit/governance/reviewing.md) packs; link rather than repeat.

## Design

**Load-bearing:** Specify necessary boundaries, exact wire contracts, ordering,
limits, and error behavior. Identify which decisions require human resolution.

**Optional mechanics:** Identify implementation latitude without silently
mandating a framework or speculative module inventory.

## Affected code

List verified current paths and their relevant behavior at `base_commit`.
Identify future paths as proposed, not existing. Planning later resolves exact
file ownership; this section is not an invented exhaustive chunk list.

## Acceptance

Map each requirement ID to declared check IDs and expected evidence. Separately
list human-only acceptance; automation cannot stand in for consent.

Populate frontmatter checks with entries shaped like
`{id: feature-tests, command: [node, path/to/read-only-check.mjs]}`.
This example is not a runnable check. Commands are argv arrays, never shell
strings; no pipes, installs, or write-mode commands. Mark future checks proposed
and not runnable yet. Empty checks are valid only while `status: draft`.

Human review covers each check and its underlying oracle. Planners only select
IDs; neither planner nor repair agent may edit reviewed checks to obtain a pass.

## Decisions

- **Blocking:** Replace placeholders, resolve ambiguity, and review nonempty
  checks before approval/execution.
- Only explicit human approval authorizes changing status to `approved` and
  recording `approved_by` and `approved_at`; drafts keep both null. Agents never
  self-approve. `complete` means verified historical work, not active scope.
- `base_commit` is the reviewed code baseline, not necessarily current HEAD:
  committing the approved spec afterward is valid. Intervening non-spec code/config
  changes require re-grounding and human review. Stop if stale or blocked.
  Chunks use `id`, `title`, `files`, `specRefs`, `requirementIds`, `checkIds`,
  `blueprint`; exact files are owned once and refs use literal heading names.
- Feature chains cannot edit protected build policy, vendor, spec, or quality-gate
  files; workflow changes are separate human-reviewed work.
- Follow staged selective rule injection, the plan gate, sequential bounded
  chunks, one fresh reviewer, and at most two repair rounds. No push or merge.
