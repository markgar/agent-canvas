---
name: build-spec
description: Create or revise one grounded Agent Canvas feature draft for explicit human review, without planning implementation or approving it.
---

# Build one reviewable feature spec

1. Read `AGENTS.md`, `SPEC.md`, `README.md`, and `docs/architecture.md`, then
   inspect the affected code and actual full `git rev-parse HEAD`. Distinguish
   implemented scaffold, confirmed decisions, and proposed future behavior.
2. Read [product invariants](../../../.chainkit/governance/product.md) and the
   [planning gate](../../../.chainkit/governance/planning.md). Link the
   [coding](../../../.chainkit/governance/coding.md) and
   [reviewing](../../../.chainkit/governance/reviewing.md) packs as applicable;
   do not copy their rules into the feature spec or inject all packs into coding.
3. Create or update **one** draft under `specs/`, using
   [the template](../../../specs/TEMPLATE.md). Do not modify product policy,
   implementation, other specs, check scripts, dependencies, or approval records.
   Existing `complete` specs are historical, never active injected requirements.
   For an approved/complete feature, propose a new draft rather than silently
   revising the reviewed contract.
4. Supply YAML `id` (slug), `title`, `status: draft`, `base_commit` (actual
   40-hex reviewed code baseline), `approved_by: null`, `approved_at: null`, and `checks`.
   Ground a new draft in current HEAD. Committing the approved spec afterward
   does not invalidate that baseline; intervening non-spec code/config changes
   require re-grounding and human review. Never demand baseline/HEAD equality.
   Use exactly the seven template section headings. Give requirements stable
   feature-prefixed IDs and tie each to acceptance evidence.
5. Define observable outcomes, explicit exclusions, failures, negative cases,
   privacy/security boundaries, and measurable acceptance. State exact wire
   shapes, routes, events, errors, limits, and ordering where interoperability
   or safety depends on them; avoid unnecessary invented file-level mechanics.
6. Ground affected code in existing paths and identify future modules as proposed.
   Separate load-bearing design from optional implementation mechanics.
   Record unresolved decisions and whether each blocks approval/execution.
   Product/spec conflict is a human decision, not agent permission to override.
7. `checks` is an array of `{id: slug, command: [executable, argument, ...]}`.
   Commands are read-only validation, executed without a shell: no shell strings,
   pipelines, writes, installs, or deployment. Empty checks are permitted only
   for drafts. Future paths/scripts are allowed but explicitly label those
   checks **proposed and not runnable yet**.
8. Explain what each check proves; map requirement IDs to check IDs and list
   human-only acceptance separately. Commands and existing acceptance oracles
   require human review before execution approval. An existing runner may discover
   new feature tests written with implementation in later reviewed chunks; explain
   that distinction rather than requiring every new assertion before planning.
   Planners select IDs and must not weaken accepted tests or configuration.
9. Stop at a reviewable draft. Explicit user approval alone authorizes approval
   metadata/status changes; the agent never self-approves. An approved feature
   still needs a valid plan grounded in `base_commit` and HEAD, with no stale
   baseline or blocked decisions. Do not run a paid chain, implement, push, or merge.

Plans belong to the planning stage, not this skill. Their bounded sequential
chunks have `id`, `title`, `files`, `specRefs`, `requirementIds`, `checkIds`,
and `blueprint`; exact files may have explicitly planned sequential revisits;
`specRefs` uses literal heading
names. Approval must not be inferred from a request to draft, tool adoption,
check success, or a review recommendation.
Feature chains cannot edit protected build policy, vendor, spec, or quality-gate
files. Spec authoring here and workflow changes are separate human-reviewed work.
