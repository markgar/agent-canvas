# Agent build system

## Purpose and present status

Agent Canvas uses an agent workflow to turn a human-approved feature contract into
bounded, reviewed changes. Four parts work together: **feature specifications say
what must change; invariant packs say what must remain true; the chain controls
execution; evidence gates decide whether work may advance.** None substitutes for
human acceptance.

The [product specification](../SPEC.md) describes a general-purpose local visual
surface beside assistant chat. The [architecture](architecture.md) distinguishes
the implemented TypeScript/Node.js health-server foundation from future MCP,
authenticated display, sanitization, browser rendering, and SSE behavior. This
document describes the build machinery, not an implemented live-display product.

The repository contains the chain, prompts, contracts, gates, and passing offline
replay integration tests of the real executor. These validate specific scheduling
and enforcement behavior, not model judgment. No paid model build or live-product
acceptance has run, and no controlled comparison has shown this entire arrangement
to outperform simpler alternatives.

## Separate authority, stable rules, and task context

A single large instruction file would be simple to distribute but would mix
product authority, implementation habits, and temporary task details. Instead,
Agent Canvas owns small, named policy packs:

| Document                                                                                  | Durable responsibility                                                                                                                           | Explicit recipients                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [Product invariants](../.chainkit/governance/product.md)                                  | General-purpose presentation; no email authority; local authentication; isolated untrusted content; privacy; state semantics; runtime boundaries | Planner, builders, fixers, all reviewers                                        |
| [Planning obligations](../.chainkit/governance/planning.md)                               | Approval, repository grounding, ownership, dependency order, requirement/check coverage                                                          | Planner and plan reviewer                                                       |
| [Coding obligations](../.chainkit/governance/coding.md)                                   | Owned-file changes, preserved behavior and checks, safe increments, bounded repairs                                                              | Builder and fixer                                                               |
| [Review obligations](../.chainkit/governance/reviewing.md)                                | Evidence inspection, attributable defects, negative cases, oracle integrity, honest acceptance                                                   | Plan reviewer and implementation reviewers                                      |
| [Architecture](architecture.md) and [feature design](../specs/001-live-display.md#design) | Lasting implementation boundaries; proposed integration/security/protocol contracts remain draft until approved                                  | Consulted when relevant to the selected feature                                 |
| [Selected feature](../specs/001-live-display.md)                                          | One proposed or approved change, exclusions, requirements, design, acceptance, decisions                                                         | Full document for planning/review; selected literal sections for implementation |

These packs are first-class inputs, not an appendix or a hope that agents remember
repository conventions. The [chain](../.chainkit/chains/build-feature.yaml) loads
named policy seeds; [prompts](../.chainkit/prompts/) interpolate the relevant packs
explicitly. Repository custom instructions are not automatically imported into
these stages. Linked documents require deliberate reading; a link is not equivalent
to its contents being present in a prompt.

The alternative of loading everything, including old specs, increases repeated
tokens and the opportunity for stale or conflicting instructions. Context research
[1] supports restraint, not eliminating useful instructions: generated repository
context increased cost without a statistically significant completion improvement
in that experiment. It did not test these stage-specific packs. Their usefulness
here remains a hypothesis to measure.

Invariants should therefore contain stable, consequential rules, not encyclopedic
repository summaries. Prefer enforcement in code, schemas, lint boundaries, and
tests where possible. Humans maintain the remaining policy and resolve conflicts.
Human approval of integration, security, or protocol documents establishes design
authority only; it does not authorize a paid build or establish implementation.
The product specification and feature frontmatter record their own review
status; workflow policy does not approve proposed protocols.
Approval metadata records declared approval, not cryptographic human
authentication.

## A complete feature contract before decomposition

The [authoring skill](../.github/skills/build-spec/SKILL.md) and
[template](../specs/TEMPLATE.md) produce one reviewable draft. The
[contract parser](../.chainkit/scripts/contracts.ts) requires YAML frontmatter:
`id`, `title`, `status`, `base_commit`, `approved_by`, `approved_at`, and
`checks: [{id, command: [executable, argument, ...]}]`. Status is `draft`,
`approved`, or `complete`; the base is a full commit hash. The Markdown body
requires exactly named level-two sections: **Outcome, Scope, Requirements, Design,
Affected code, Acceptance, Decisions**. Numbered requirement IDs enable traceability.

The full contract comes before a plan so decomposition cannot quietly invent the
product. It specifies observable outcomes, exclusions, failures, negative cases,
and load-bearing contracts. Optional mechanics remain optional: prescribing every
function would create a second implementation to maintain. Ambiguity research [3]
favors targeted behavioral clarification over indiscriminate expansion; it does
not establish an ideal spec length.

Humans review acceptance commands and existing oracles, not just prose. Runners
must exist before execution; new feature tests and narrow fixtures can be written
with implementation in reviewed chunks. Checks remain argv arrays and planners
select existing IDs. This avoids turning readiness into a whole-feature test
implementation project ahead of the planner. New tests cannot weaken existing
accepted obligations, and a green scaffold is not evidence of new behavior.

The [wrapper](../.chainkit/scripts/cli.ts) requires an approved document, nonempty
approval fields and checks, and a clean worktree. Common blocking placeholders are
rejected; this is not a semantic detector for every unresolved decision. The base
must be an ancestor of HEAD. Only the selected spec may differ from that base,
allowing its later approval commit without requiring a self-referential commit
hash. Intervening code or policy drift requires re-grounding and reapproval.
The selected document is frozen during execution.

This rejects “start coding from a short request and discover intent through
repairs.” The cost is specification and approval time; the benefit sought is fewer
expensive corrections to misunderstood behavior. It is an engineering hypothesis,
not proof that every small change needs extensive documentation.

## Execution: where each decision becomes binding

```text
Human-reviewed invariants + complete approved feature + fresh repository
                              |
                         preflight
                              v
        plan -> mechanical checker -> fresh plan review
          ^                              |
          +------- bounded revision -----+  rejection blocks coding
                              |
                        lock reviewed plan
                              v
            1–8 chunks, sequential dependency order
       selected spec sections + check IDs -> builder
                              |
                    independent measurements
                              |
                 fresh reviewer, full feature
                              |
             semantic pass AND checks AND scope?
                 no                       yes
       at most two repairs                 |
       each remeasured/reviewed      recheck current tree
                 |                         |
         unresolved: stop          framework local commit
                                           |
                                next chunk / final gate
                                           |
                   every approved check + npm run check
                                           |
                              human acceptance pending
```

| Stage                 | Mechanism and evidence                                                                                            | Failure boundary                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Preflight             | Vendor verification, approval, clean tree, baseline freshness                                                     | Stop before model spend                                             |
| Plan/check/review     | JSON plan; exact paths and section references; requirement/check coverage; independent behavioral review          | Invalid structure or rejected semantics cannot enter implementation |
| Prepare/build         | Locked assignment and literal spec sections, including subsections                                                | No ownership expansion or self-approved contract changes            |
| Measure/review/decide | Host-run commands, outputs, exit statuses, scope inventory, tree fingerprint; reviewer reads source and full spec | Both semantic and mechanical acceptance required                    |
| Repair                | Concrete findings, same assignment, fresh measurements and review                                                 | At most two repairs; exhaustion stops                               |
| Chunk gate/checkpoint | Matching reviewed fingerprint, repeated checks, no-op rejection                                                   | Only framework creates local checkpoint                             |
| Final gate            | All approved feature commands and repository-wide `npm run check`                                                 | Integration failure stops; human acceptance remains separate        |

The plan contains chunk `id`, `title`, `files`, `specRefs`, `requirementIds`,
`checkIds`, and `blueprint`. Mechanical validation rejects duplicate paths within a chunk,
invalid/protected paths, ambiguous section references, unknown IDs, and missing
coverage. Mentioning every ID is not proof of behavioral coverage: a fresh reviewer
must challenge the blueprint and whether chosen checks distinguish correct from
incorrect behavior. The plan/review loop is bounded to two rounds.

Sequential chunks deliberately reject speculative parallelism. Earlier chunks are
committed before later work begins. A later chunk may explicitly revisit a file
listed in its reviewed assignment, rather than forcing unrelated capabilities
into one oversized chunk. Eight is an operational ceiling, not a context budget;
plan review must reject chunks too broad to understand with their focused tests.
If the feature cannot fit, reduce its scope rather than bypass that review.

Builders receive precise sections rather than the planner's paraphrase alone.
Reviewers receive the full feature so omitted context remains discoverable, while
judging only the current assignment and regressions—not absent later chunks.
Fresh context reduces dependence on the builder's explanation; it does not produce
statistical independence. Fixers receive findings and measurements, and every repair
gets a fresh review that can identify new regressions.

The executable [stage adapter](../.chainkit/scripts/stage.ts) combines reviewer
acceptance with measured acceptance. Chunk measurements rebuild current artifacts, then run typechecking, baseline
regressions, selected approved checks and formatting; the chunk `gate` repeats
measurement before checkpointing. A failed build cannot use old artifacts.
Loop bounds use `max`. The final `gate` reruns every approved feature check plus
`npm run check` against the assembled clean tree. No final integration-repair loop
is configured. There is no push, PR creation, merge, or automatic human approval.

## Why separate tests, judgment, and enforcement?

Tests provide reproducible feedback; semantic review asks whether they test the
right behavior. In small programming exercises, supplying tests and repair
feedback improved GPT-4 results [2]. In repository repair, Agentless's patch-filter
ablation improved results when regression and reproduction checks were added [5].
These motivate executable evidence, but neither proves this workflow or strict TDD
superior for a real application.

“The agent says tests passed” is weaker than an independently executed command.
Here the host records actual results and compares repository fingerprints around
checks and reviews. Stale review cannot authorize a changed tree; failed checks or
scope violations cannot be overridden by a favorable model verdict. Repeating
checks adds runtime and may expose flakiness, but avoids treating earlier evidence
as current acceptance.

This is **not a hostile-code sandbox**. Commands execute in the worktree with
`shell: false`, bounded output, a two-minute timeout, and before/after snapshots;
they are checked for read-only behavior, not executed inside an isolated read-only
filesystem. Ignored caches/build output fall outside the fingerprint. Processes
can still access machine resources and networks. Use trusted reviewed commands and
an appropriately restricted execution environment.

Protected paths and frozen existing npm scripts prevent common ways to weaken
the pipeline. Governance, vendor, specs, and quality-control changes require
separate human-reviewed work; feature agents cannot grant themselves that
authority. Underlying test meaning still needs review: editable generated tests
and a semantic reviewer can be jointly wrong. EvalPlus [4] demonstrates how stronger
held-out tests expose errors missed by familiar tests, including reference-oracle
errors. No quantity of green output establishes completeness.

## Ownership, cost, evidence, and maintenance

[Vendored Chainkit](../vendor/chainkit/README.md) remains an unchanged pinned local
engine; Agent Canvas owns `.chainkit/` policy, prompts, adapters, and `specs/`.
This rejects both a private engine fork and embedding app policy in generic
orchestration. Upgrades can replace the vendor snapshot without losing local
behavior. Inventory hashes detect changes relative to the recorded pin; they do
not prove upstream provenance. Human upgrade review and local compatibility tests
remain necessary.

Current defaults are `gpt-5.6-sol` for planning/building/fixing and
`claude-opus-4.8` for review, with high effort and a 15-minute stage timeout.
These are practical, editable defaults—not benchmark proof of model superiority
or of cross-model independence. Budget includes spec review, planning retries,
full-spec reviewer tokens, up to three build/review passes per chunk, repeated
commands, and human acceptance. Bounded retries cap a failure mode; they are not
a fixed monetary budget.

The [operations guide](../.chainkit/README.md) separates free configuration
validation, deterministic adapter tests, vendor self-tests, and explicit paid
execution. Passing [offline replay integration tests](../.chainkit/scripts/engine.test.ts)
exercise the actual YAML scheduling, wrapper, and gates. They demonstrate:

- A passing chunk receives an automatic local checkpoint without unnecessary repair.
- A rejected plan blocks implementation.
- A still-rejected chunk exhausts bounded repairs without receiving a checkpoint.

Model reply streams and the builder's edit are fixture substitutes. This is real
executor integration evidence, not a paid model build, evidence of model reasoning
quality, or live-product acceptance. Contract and stage tests separately exercise
mechanical rules. The current [live-display draft](../specs/001-live-display.md)
uses existing runners with new feature tests assigned to implementation chunks.
Neither scaffold success nor the document's existence is execution approval.

Runs write records and logs under `.chainkit/results/`; coordination state is
temporary. For an auditable delivery, retain the exact feature, base and final
commits, vendor/config/model versions, plan, selected references and check IDs,
actual command outcomes, reviewer findings, repair dispositions, checkpoint IDs,
and unresolved human acceptance. Distinguish observed results from agent claims
and record missing telemetry rather than estimating it as fact. Logs may contain
source, prompts, or sensitive output; retention and sharing need care.

After a failure, inspect evidence and the remaining worktree rather than blindly
retrying. Changes to intent, scope, or policy require renewed human authority.
After human acceptance, retain the feature as historical `complete` material.
Promote lasting truths into maintained architecture/decision documents, code,
schemas, and tests. Do not replay every completed spec into future prompts.
This maintenance obligation addresses document inflation and drift highlighted by
practitioner experience [6], which is useful warning rather than controlled evidence.

## Evaluate locally before declaring a winner

Compare this arrangement against a simpler agent-plus-checks baseline and targeted
ablations, such as removing plan review or varying pack selection. Hold task,
model assignment, tools, and total budget fixed. Randomize treatment order across
matched, diverse repository tasks and repeat runs; include integration,
security-boundary, ambiguous-requirement, and regression tasks, not only easy
isolated functions.

Use human-reviewed hidden acceptance prepared independently of agent-generated
tests. Do not derive or revise visible specs from the hidden oracle. Measure
delivered correctness, regressions, unsafe/scope changes, failure causes, tokens
and money, elapsed time, and human specification/review time. Report uncertainty
and unsuccessful runs, not just demonstrations. The decision is whether added
structure improves useful outcomes enough to justify its operational cost—not
whether an elaborate chain can eventually produce one success.

## Research references and their limits

1. **Gloaguen et al., [Evaluating AGENTS.md](https://arxiv.org/html/2602.11988v2),
   June 23, 2026 revision.** SWE-bench Lite: 300 tasks/11 Python repositories;
   CTXbench: 138 tasks/12 repositories, four configurations. Generated context
   raised cost about 20%/23%; completion uplift versus none was not statistically
   significant (`p=.87`, `.37`). Developer context versus none: `p=.21`;
   developer versus generated: `p=.038`. Not evidence that all instructions are
   useless, nor a stage-specific workflow experiment.
2. **Mathews and Nagappan, [Test-Driven Development for Code Generation](https://arxiv.org/html/2402.13521v2), 2024.** GPT-4 MBPP hidden evaluation: 69.67% with prose, 82.45% with supplied
   tests, 87.71% with repair. Small exercises, not a real-app or strict-TDD
   head-to-head evaluation.
3. **Jia et al., [Automated Repair of Ambiguous Problem Descriptions](https://arxiv.org/html/2505.07270v3), 2025.** Targeted behavioral ambiguity repairs help; vanilla expansion sometimes
   hurts. Supports clarification, not comprehensive up-front implementation prose.
4. **Liu et al., [EvalPlus](https://arxiv.org/html/2305.01210v3), 2023.**
   Stronger held-out tests reduced GPT-4 HumanEval results from 88.4% to 76.2%;
   more than 10% of reference solutions were incorrect. Demonstrates test and
   oracle limitations, not a universal expected failure rate.
5. **Xia et al., [Agentless](https://arxiv.org/html/2407.01489v2), 2024,
   Table 4.** Patch-filter ablation: 77/300 with majority selection, 81 with
   regression filtering, 96 with reproduction filtering added. Repository repair
   evidence for this filtering mechanism, not proof that the present chain wins.
6. **Birgitta Böckeler, [Spec-driven development: three tools](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html),
   October 2025.** Firsthand critique of specification-document inflation and
   drift. Practitioner observation, not a controlled causal comparison.
