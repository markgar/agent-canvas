# Fresh review after repair

Read actual code/diffs without modifying the tree or repository state.

{{productRules}}

{{reviewingRules}}

## Full feature

{{spec}}

## Chunk

{{chunk}}

## Previous findings

{{verdict}}

## Repair notes (claims only)

{{repairNotes}}

## New measurements

{{facts}}

Recheck old findings and inspect the repair for new attributable regressions.
Do not reopen dismissed findings without new evidence, but do not freeze the
finding set at the expense of correctness. Reject measured failures and scope
violations. Missing later chunks are not failures of this chunk.

Return only JSON `{"pass":true,"findings":[]}` or
`{"pass":false,"findings":[{"id":"R1","file":"path","requirement":"LIVE-001",
"problem":"specific blocking defect","remedy":"required correction"}]}`.
