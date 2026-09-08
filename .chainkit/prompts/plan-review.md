# Review the plan before implementation

Read repository evidence without editing files, staging, or committing.

{{productRules}}

{{planningRules}}

{{reviewingRules}}

## Complete feature contract

{{spec}}

## Plan

{{plan}}

Check behavioral coverage, negative cases, dependency ordering, exact file
ownership, specRefs selection, and whether the approved checks can meaningfully
discriminate the required behavior. A requirement ID being mentioned is not proof
of coverage. Do not require later chunks' behavior in an earlier chunk's check.
Reject a plan that requires weakening existing scripts or changing build policy.
Reject oversized or cross-cutting test-only chunks. Implementation, focused tests,
and essential local fixtures belong together. Review explicitly listed later
file revisits instead of requiring unrelated work to share one large chunk.
Require concrete tests for new behavior; existing scaffold checks alone are not
meaningful coverage. A feature-wide check belongs only after its prerequisites.

Report at most five consequential blocking findings. A blocker must identify an
unmet requirement, invalid dependency or ownership boundary, unsafe design decision,
or acceptance gap that could let incorrect behavior pass. Omit stylistic preferences,
speculative improvements, and alternative designs that are not required by the
approved contract. Give the plan fixer exact, bounded corrections rather than asking
for wholesale replanning.

Return only JSON `{"pass":true,"findings":[]}` or
`{"pass":false,"findings":[{"id":"P1","file":"path","requirement":"LIVE-001",
"problem":"specific blocking defect with evidence","remedy":"required correction"}]}`.
The verdict records whether corrections are needed; a single direct plan-fix follows.
