---
name: build-feature
description: Prepare or deliberately launch an approved Agent Canvas feature through Chainkit, with readiness checks, explicit execution consent, and bounded failure handling.
---

# Launch one approved feature

Use this after `build-spec` and the separately reviewed build/test preparation.
This skill operates the repository's development workflow; it does not require
or implement a host's native canvas capability.

## Establish scope and consent

1. Read `AGENTS.md`, [the operating guide](../../../.chainkit/README.md),
   [planning obligations](../../../.chainkit/governance/planning.md), and the
   selected feature under `specs/`. Select an explicitly named spec, or ask the
   user if the selection is ambiguous. Never choose a draft just because it is
   the first file.
2. Distinguish **prepare only** from **execute**. A request to inspect readiness,
   approve a spec, commit, or merge is not permission to spend model credits.
   Invoking this skill without clear execution consent means readiness only.
   Never start a run when the user says to stop before the build.
3. For a fresh build after landing preparation, first confirm that the reviewed
   preparation and spec are merged to the intended repository's `main`. Use a new,
   dedicated feature worktree/session based on that main, not the preparation
   worktree or the shared main checkout. Use the host's worktree/session tools
   when available; do not assume a particular development app or canvas API.

## Confirm readiness without model calls

4. Inspect the current branch, actual HEAD, and all tracked/untracked changes.
   Require a clean, committed repository-root worktree. Preserve unrelated work;
   do not reset, stash, or commit it just to satisfy preflight.
5. Require `status: approved`, real human approval attribution/time, nonempty
   reviewed acceptance commands, and no unresolved blocking decisions. Approval
   must be explicit; never invent metadata or promote a draft based on successful
   checks or an agent recommendation. Completed specs are historical, not runnable.
6. Verify the reviewed `base_commit` is an ancestor of HEAD and only the selected
   spec differs between them. An approval-only spec commit is allowed; do not
   require baseline/HEAD equality. Intervening code, tooling, policy, or other
   spec changes require re-grounding and human review.
7. Confirm the prepared build tooling, actual acceptance scripts/oracles, required
   dependencies/browser binaries, and supported runtime exist. A future feature's
   behavioral assertions may still fail before implementation; missing tooling,
   skipped cases, and placeholder oracles are not readiness. Do not weaken checks,
   alter governance, or silently install prerequisites as part of a launch.
8. Read the configured model names from
   [the chain](../../../.chainkit/chains/build-feature.yaml). Confirm the operator
   has an authenticated Copilot CLI and access to those models. Do not make paid
   probe calls or claim offline validation establishes model availability.
9. From the repository root, substitute the selected repository-relative spec path:

   ```sh
   npm run chainkit:validate -- --spec specs/001-live-display.md
   ```

   This checks document structure and chain wiring without model calls. It does
   not approve the spec or prove semantic completeness or execution readiness.
   If any prerequisite is missing, report that blocker and stop. Do not launch a
   partial build to discover missing preparation.

## Execute only when explicitly authorized

10. Before execution, ensure the user's consent covers this spec/worktree and
    **model-credit spending plus local checkpoint commits**. If it does not, ask
    for that consent. Spec approval and execution consent are separate.
11. Recheck readiness after any intervening edits or approval changes. With the
    selected spec substituted, run this command from the repository root:

    ```sh
    npm run chainkit:run -- \
      --spec specs/001-live-display.md \
      --workdir "$PWD" \
      --execute
    ```

    Use the wrapper, never `vendor/chainkit/run.mjs` directly. Observe the existing
    process to completion; do not launch a duplicate when a tool call times out.
    The chain owns planning, review, bounded repair, and local checkpoint commits.
    Do not add a second orchestration/factory loop around it.

## Handle the result honestly

12. Inspect the exit result, `.chainkit/results/` run records, and resulting
    worktree. Logs may contain generated source, prompts, or other sensitive
    material; do not dump them wholesale or copy secrets into summaries.
13. On failure, preserve checkpoints and remaining changes. Report the failed
    stage, concrete blocker, and evidence. Do not reset, automatically retry,
    bypass exhausted repair limits, or imply that the wrapper resumes old state.
    Changes to scope, plan, checks, or baseline need the appropriate review before
    a fresh explicitly authorized run.
14. On success, report the produced commits and outstanding human acceptance.
    A passing chain does not mark the feature complete, authorize a real-email
    demonstration, push, open a PR, or merge. Those remain separate user actions.
