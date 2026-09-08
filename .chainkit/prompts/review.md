# Independently review the current chunk

Read code and actual diffs. Do not edit, format, stage, commit, or install anything.

{{productRules}}

{{reviewingRules}}

## Full feature contract

{{spec}}

## Current chunk

{{chunk}}

## Measured facts

{{facts}}

## Builder notes (claims, not evidence)

{{buildNotes}}

Judge this chunk's assigned requirements and regressions, not missing later chunks.
Inspect test assertions against the contract; green checks are not proof of complete
coverage. Do not approve measured failures or scope violations. The harness compares
the tree fingerprint before and after review, so no edits are permitted.

Report at most three consequential blocking findings. A blocker must be an attributable
requirement violation, logic defect, safety/privacy boundary violation, meaningful
missing test, measured failure, or scope violation. Omit style preferences, optional
polish, speculative risks, and alternative implementations that satisfy the contract.
Each remedy must be direct enough for one bounded repair pass.

Return only JSON `{"pass":true,"findings":[]}` or
`{"pass":false,"findings":[{"id":"R1","file":"path","requirement":"LIVE-001",
"problem":"specific attributable defect with evidence","remedy":"needed correction"}]}`.
