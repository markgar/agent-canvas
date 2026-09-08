export function exampleSpec(base = 'a'.repeat(40)): string {
  return `---
id: example
title: Example feature
status: approved
base_commit: ${base}
approved_by: Test operator
approved_at: '2026-09-08T15:00:00Z'
checks:
  - id: behavior
    command: [node, '-e', 'process.exit(0)']
---
## Outcome
An observable result.
## Scope
Only the example.
## Requirements
- **EX-001**: The feature must behave as specified.
## Design
Keep the existing boundary.
### Nested detail
This detail must survive slicing.
\`\`\`md
## Not a real heading
\`\`\`
## Affected code
src/value.ts
## Acceptance
EX-001 is exercised by behavior.
## Decisions
No blocking decisions.
`;
}

export function examplePlan() {
  return {
    chunks: [
      {
        id: 'value',
        title: 'Build a value',
        files: ['src/value.ts'],
        specRefs: ['Requirements', 'Design'],
        requirementIds: ['EX-001'],
        checkIds: ['behavior'],
        blueprint: 'Implement and test the required value.',
      },
    ],
  };
}
