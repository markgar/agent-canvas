# Running feature builds

Chainkit executes the workflow. This directory supplies Agent Canvas's policy.
Read [the design rationale](../docs/build-system.md) for why the system is structured
this way; this page describes how to operate it.

## Prepare a contract

1. Commit the repository foundation before choosing a feature baseline.
2. Use [the authoring skill](../.github/skills/build-spec/SKILL.md) and
   [template](../specs/TEMPLATE.md). Ground the spec against a full `base_commit`.
3. Review requirements, failure cases, implementation boundaries, exact owned-file
   candidates, and acceptance commands. Commands are argv arrays, not shell strings.
4. Resolve blocking decisions. With the user's approval, record `status: approved`,
   `approved_by`, and an ISO `approved_at`, then commit the selected spec.

The base must be an ancestor of HEAD. Only the selected spec may differ between
that base and HEAD; any intervening code, policy, or other spec changes require
re-grounding and reapproval. This permits a spec-approval commit without pretending
a document can name the hash of the commit containing itself.

Approval fields record an assertion, not authenticated proof of human consent.
Reviewing their meaning is an operator responsibility. Draft and completed specs
cannot execute. Never put private email, source-system credentials, or production
content into a spec or build prompt.

Commands and existing acceptance tests are reviewed inputs. New feature tests and
narrow helpers may be created alongside implementation in each reviewed chunk.
An existing runner is required; a fully implemented future-feature test suite is
not. Scaffold-only success never proves new behavior. Agents cannot weaken prior
accepted assertions, scripts, or thresholds.

## Validate without model calls

```sh
npm run chainkit:validate
npm run chainkit:validate -- --spec specs/001-live-display.md
npm run chainkit:selftest
npm test -- .chainkit/scripts
```

Validation checks the vendor inventory, document structure, and upstream chain
configuration. It does not approve a draft, establish semantic completeness, prove
that acceptance commands are correct, or check model availability. The upstream
self-tests use local fixtures/replay and make no paid model calls.

## Execute deliberately

With a clean, committed worktree and an approved feature:

```sh
npm run chainkit:run -- \
  --spec specs/001-live-display.md \
  --workdir /absolute/path/to/agent-canvas-worktree \
  --execute
```

Use a dedicated feature worktree. The explicit flag acknowledges **model spend and
local checkpoint commits**. The configured models require an authenticated Copilot
CLI with access to those models. Model names and timeouts are operational defaults
in `chains/build-feature.yaml`, not claims about optimal model selection.

Do not invoke `vendor/chainkit/run.mjs` directly for this workflow: the wrapper
establishes the approved run state needed by the gates. Runs write logs and records
to `.chainkit/results/`, which is ignored by Git. Temporary coordination state is
removed when the wrapper exits normally. Logs can contain generated source,
prompts, findings, and command output; treat them as potentially sensitive.

## What a run does

The planner assigns one to eight cohesive, context-sized sequential chunks with
exact file ownership per active chunk. Later chunks may explicitly revisit a file;
dependencies and preservation of earlier behavior are reviewed. Each requirement
and approved check must be assigned. The plan receives
a blocking independent review, with at most two planning rounds; deterministic
plan completion has at most two attempts within each round.

Each chunk receives the product/coding rules and literal selected spec sections,
including their subsections. The builder writes the capability and focused tests.
The host rebuilds current artifacts, then executes typechecking, baseline tests,
selected acceptance commands and formatting. Build failure blocks checks against
old artifacts. A fresh reviewer sees the full spec and measured
facts. Builder notes are not evidence. A passing model verdict cannot override
failed checks or out-of-scope files.

A rejected chunk gets at most two repair rounds with new measurements and fresh
reviews. New regressions may be reported. The passing-review fingerprint must still
match the current tree; acceptance and ownership are checked again before the
executor stages and commits the chunk. A no-op chunk is rejected.

The final gate runs every approved acceptance command and `npm run check` on the
assembled clean tree. Final failures stop; there is no automatic integration-repair
stage. No run pushes, opens a PR, merges, sends email, or approves human acceptance.
Checkpoint commits and failed changes remain available for inspection.

## Comparing clean and prepared-test inputs

Use the same behavioral contract and chain/model configuration on two committed
variant branches. The clean checkout contains no prewritten feature acceptance
suite; its planner assigns those tests with the capabilities. The prepared checkout
adds its reviewed suite before its code baseline is selected. Each variant has
its own approval-only spec commit and clean worktree. Never copy the preparation
conversation or test code into the clean session, and never put both suites on
the common main baseline while asking an agent to ignore one.

Both use the same `chainkit:run` command and [build-feature skill](../.github/skills/build-feature/SKILL.md).
Creating an idle session is not permission to execute it. Worktrees isolate files,
not Git objects or machine resources; use independent clones/environments for a
strict isolation experiment. Foreground/latency evidence must not overlap on one
machine or compete with another build. Record preparation cost separately from
each run, and evaluate public behavior rather than another variant's test ports.

## Boundaries and failure handling

Acceptance commands run with `shell: false`, a two-minute timeout, bounded output,
and before/after repository fingerprints. Ordinary test failure is measurement data
for repair; spawn errors, timeouts, mutations, and malformed artifacts stop rather
than manufacture a success result.

These are accidental-error controls, **not an OS sandbox against hostile agents or
commands**. Ignored build/cache files are outside the fingerprint. Approved commands
can still access the operator's machine and network; review executable arguments
and use an appropriately restricted environment when needed.

Feature plans cannot own vendor, workflow, specs, governance, or the existing
quality-gate configuration. Existing npm scripts are frozen even when a feature
owns `package.json` for approved dependency changes. A necessary change to those
controls belongs in a separate human-reviewed change.

After a failure, inspect the run record, logs, and working tree. Do not blindly
reset or retry. Decide whether the implementation, plan, or spec is wrong. Correct
and re-ground as needed before a fresh run; this wrapper does not resume old
temporary state. Mark a feature complete only after reviewing the assembled result
and performing its separate human acceptance.

## Update the vendor pin

The current source is `markgar/chainkit` at
`c3fdaed1dd0ed182f3ec34bbe3b5b6062b08f670`, with its MIT license retained.
`.chainkit/vendor.json` records every file's SHA-256 and executable bit.

For an intentional upgrade, inspect a clean upstream checkout and select a committed
revision. Replace only the existing vendor snapshot with that revision's complete
`git archive`; do not overlay it and leave removed upstream files behind. Keep the
license intact and do not patch upstream files locally. Then record and inspect:

```sh
npm run chainkit:vendor -- record <full-upstream-commit>
npm run chainkit:vendor -- check
npm run chainkit:selftest
npm run check
```

`record` inventories the installed files; it does not prove they came from the stated
commit. Verify provenance against the selected upstream archive during review.
The root npm installation supplies runtime dependencies; upstream's own development
workspace and package manager are not installed here.
