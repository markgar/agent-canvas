# Plan an approved feature

Read the actual repository; do not change any file or run a paid chain. Repository
custom instructions are not automatically loaded in these stages. The following
explicit policy is authoritative.

## Product invariants

{{productRules}}

## Planning obligations

{{planningRules}}

## Approved feature

{{spec}}

## Previous review

{{planVerdict}}

Return only JSON: `{"chunks":[{"id":"slug","title":"outcome","files":["literal/path.ts"],
"specRefs":["exact heading"],"requirementIds":["LIVE-001"],"checkIds":["approved-check"],
"blueprint":"grounded implementation and verification decisions"}]}`.

Use 1-8 cohesive, context-sized sequential chunks, ordered by dependency.
List exact files for each chunk. Later chunks may explicitly revisit earlier
files; explain that dependency rather than merging unrelated capabilities.
Every requirement and approved check must be assigned. Check IDs
select the spec's approved argv commands; never replace them with invented commands.
References must be exact, unambiguous Markdown headings. Include every section the
builder needs, including relevant negative cases. Investigate structural type
consumers before fixing ownership. Plan implementation and focused tests together;
do not assign one whole-feature test-writing chunk before the capabilities.
Existing runners can discover new tests authored in their owning chunks. The
host always builds, typechecks, and runs existing regressions; select additional
feature checks only in chunks where their prerequisites are complete.
Explain concrete positive/negative evidence per requirement. Green scaffold tests
are not feature evidence. The mechanical checker validates structure, not coverage.
