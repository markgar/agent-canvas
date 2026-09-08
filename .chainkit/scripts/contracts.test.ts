import { describe, expect, it } from 'vitest';

import {
  parseSpec,
  requireApproval,
  reviewSchema,
  sliceSpec,
  validateOwnedPath,
  validatePlan,
} from './contracts.js';

import { examplePlan, exampleSpec } from './test-fixtures.js';

describe('feature contracts', () => {
  it('parses explicit approval and numbered requirements', () => {
    const spec = parseSpec(exampleSpec());
    expect(spec.requirements).toEqual(['EX-001']);
    expect(() => {
      requireApproval(spec);
    }).not.toThrow();
    expect(validatePlan(examplePlan(), spec)).toEqual(examplePlan());
  });

  it.each(['draft', 'complete'])('does not execute a %s spec', (status) => {
    expect(() => {
      requireApproval(
        parseSpec(
          exampleSpec().replace('status: approved', `status: ${status}`),
        ),
      );
    }).toThrow('explicitly approved');
  });

  it.each([
    ['approved_by: Test operator', 'approved_by: null'],
    ["approved_at: '2026-09-08T15:00:00Z'", 'approved_at: null'],
    ['No blocking decisions.', 'OPEN BLOCKER: decide authorization'],
  ])('rejects missing approval or blocking decisions', (before, after) => {
    expect(() => {
      requireApproval(parseSpec(exampleSpec().replace(before, after)));
    }).toThrow();
  });

  it('rejects malformed documents and duplicate frontmatter keys', () => {
    expect(() => parseSpec('just prose')).toThrow('frontmatter');
    expect(() =>
      parseSpec(
        exampleSpec().replace('id: example', 'id: example\nid: duplicate'),
      ),
    ).toThrow();
    expect(() =>
      parseSpec(exampleSpec().replace('## Scope', '## Other')),
    ).toThrow('Scope');
    expect(() =>
      parseSpec(exampleSpec().replace('**EX-001**', '**unnumbered**')),
    ).toThrow('numbered');
  });

  it('requires unique check IDs and an argv array', () => {
    expect(() =>
      parseSpec(
        exampleSpec().replace(
          'command: [node',
          'command: echo something\n    other: [node',
        ),
      ),
    ).toThrow();
    expect(() =>
      parseSpec(
        exampleSpec()
          .replace('## Outcome', '## Outcome')
          .replace(
            "    command: [node, '-e', 'process.exit(0)']",
            '    command: [node]\n  - id: behavior\n    command: [node]',
          ),
      ),
    ).toThrow('unique');
  });

  it('slices literal sections with children, ignoring fenced headings', () => {
    const spec = parseSpec(exampleSpec());
    const result = sliceSpec(spec, ['Design', 'Nested detail']);
    expect(result).toContain('### Nested detail');
    expect(result).toContain('## Not a real heading');
    expect(result.match(/This detail/g)).toHaveLength(1);
    expect(result).not.toContain('## Affected code');
    expect(() => sliceSpec(spec, ['Not a real heading'])).toThrow(
      'exactly once',
    );
    expect(() =>
      sliceSpec(parseSpec(`${exampleSpec()}\n## Design\nDuplicate.`), [
        'Design',
      ]),
    ).toThrow('exactly once');
  });

  it.each([
    '../outside.ts',
    '/absolute.ts',
    'src/../value.ts',
    'src/*.ts',
    'src\\value.ts',
    'src/',
    '-option',
    '.',
    '.git/config',
    '.chainkit/prompts/code.md',
    'vendor/chainkit/run.mjs',
    'specs/example.md',
    'AGENTS.md',
    'vitest.config.ts',
  ])('rejects unsafe or protected ownership: %s', (file) => {
    expect(() => {
      validateOwnedPath(file);
    }).toThrow();
  });

  it('allows literal source and dependency files', () => {
    expect(() => {
      validateOwnedPath('src/new-file.ts');
    }).not.toThrow();
    expect(() => {
      validateOwnedPath('package.json');
    }).not.toThrow();
  });

  it('allows explicitly planned sequential revisits but rejects duplicate paths within a chunk', () => {
    const spec = parseSpec(exampleSpec());
    const chunk = examplePlan().chunks[0];
    expect(() =>
      validatePlan({ chunks: [chunk, { ...chunk, id: 'later' }] }, spec),
    ).not.toThrow();
    expect(() =>
      validatePlan(
        { chunks: [{ ...chunk, files: ['src/value.ts', 'src/value.ts'] }] },
        spec,
      ),
    ).toThrow('Duplicate file in chunk');
  });

  it('rejects empty, oversized, or incomplete plans', () => {
    const spec = parseSpec(exampleSpec());
    const chunk = examplePlan().chunks[0];
    expect(() => validatePlan({ chunks: [] }, spec)).toThrow();
    expect(() =>
      validatePlan({ chunks: Array(9).fill(chunk) }, spec),
    ).toThrow();
    expect(() => validatePlan({ chunks: [chunk, chunk] }, spec)).toThrow(
      'Duplicate chunk',
    );
    expect(() =>
      validatePlan(
        { chunks: [{ ...chunk, requirementIds: ['EX-999'] }] },
        spec,
      ),
    ).toThrow('Unknown requirement');
    expect(() =>
      validatePlan({ chunks: [{ ...chunk, checkIds: ['invented'] }] }, spec),
    ).toThrow('Unknown approved');
    expect(() =>
      validatePlan(
        examplePlan(),
        parseSpec(
          exampleSpec().replace(
            '## Design',
            '- **EX-002**: Also required.\n## Design',
          ),
        ),
      ),
    ).toThrow('Every requirement');
    expect(() =>
      validatePlan(
        examplePlan(),
        parseSpec(
          exampleSpec().replace(
            '---\n## Outcome',
            '  - id: extra\n    command: [node]\n---\n## Outcome',
          ),
        ),
      ),
    ).toThrow('Every approved');
  });

  it('requires a coherent semantic verdict, not truthy or empty rejections', () => {
    expect(reviewSchema.safeParse({ pass: true, findings: [] }).success).toBe(
      true,
    );
    expect(reviewSchema.safeParse({ pass: 'true', findings: [] }).success).toBe(
      false,
    );
    expect(reviewSchema.safeParse({ pass: false, findings: [] }).success).toBe(
      false,
    );
  });
});
