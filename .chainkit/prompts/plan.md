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

Use 1-8 sequential chunks, ordered by dependency; no duplicate file ownership.
Every requirement and approved check must be assigned. If shared files cannot be
owned independently, combine work rather than inventing parallelism. Check IDs
select the spec's approved argv commands; never replace them with invented commands.
References must be exact, unambiguous Markdown headings. Include every section the
builder needs, including relevant negative cases. Investigate structural type
consumers before fixing ownership. Do not run future checks just to discover
that their files do not exist. The mechanical plan checker validates structure,
not whether the blueprint truly covers the behavior.
