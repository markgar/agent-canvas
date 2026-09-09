# Apply the plan review once

Continue from the original planning context. Do not edit files, stage, commit, or run
a paid chain.

## Independent review

{{planReview}}

Return only the complete corrected JSON plan:
`{"chunks":[{"id":"slug","title":"outcome","files":["literal/path.ts"],
"specRefs":["exact heading"],"requirementIds":["LIVE-001"],"checkIds":["approved-check"],
"blueprint":"grounded implementation and verification decisions"}]}`.

Apply each concrete blocking remedy directly. Preserve sound chunks, ordering,
ownership, and acceptance decisions rather than replanning unaffected work. If the
review passed, return the original plan unchanged. Do not add polish, speculative
scope, or unrelated improvements. The corrected plan receives deterministic
validation and then becomes the locked build plan; it is not sent to another
semantic reviewer.
