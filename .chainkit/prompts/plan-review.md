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

Return only JSON `{"pass":true,"findings":[]}` or
`{"pass":false,"findings":[{"id":"P1","file":"path","requirement":"LIVE-001",
"problem":"specific blocking defect with evidence","remedy":"required correction"}]}`.
This verdict gates implementation. No style-only findings.
