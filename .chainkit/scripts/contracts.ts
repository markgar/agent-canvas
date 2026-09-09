import path from 'node:path';

import { parseDocument } from 'yaml';
import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const nonempty = z.string().trim().min(1);
const command = z.array(z.string().min(1)).min(1);

export const specMetadataSchema = z.strictObject({
  id: slug,
  title: nonempty,
  status: z.enum(['draft', 'approved', 'complete']),
  base_commit: z.string().regex(/^[a-f0-9]{40}$/),
  approved_by: nonempty.nullable(),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  checks: z.array(z.strictObject({ id: slug, command })),
});

const chunkSchema = z.strictObject({
  id: slug,
  title: nonempty,
  files: z.array(nonempty).min(1),
  specRefs: z.array(nonempty).min(1),
  requirementIds: z.array(z.string().regex(/^[A-Z][A-Z0-9]*-\d{3}$/)).min(1),
  checkIds: z.array(slug).min(1),
  blueprint: nonempty,
});

export const planSchema = z.strictObject({
  chunks: z.array(chunkSchema).min(1).max(8),
});

export const reviewSchema = z
  .strictObject({
    pass: z.boolean(),
    findings: z.array(
      z.strictObject({
        id: nonempty,
        file: nonempty,
        requirement: nonempty,
        problem: nonempty,
        remedy: nonempty,
      }),
    ),
  })
  .refine((review) => review.pass === (review.findings.length === 0), {
    message:
      'A passing review has no blocking findings; a rejection needs findings.',
  });

export type Plan = z.infer<typeof planSchema>;
export type Chunk = z.infer<typeof chunkSchema>;

const requiredHeadings = [
  'Outcome',
  'Scope',
  'Requirements',
  'Design',
  'Affected code',
  'Acceptance',
  'Decisions',
];

export function markdownSections(body: string) {
  const lines = body.split('\n');
  const sections: {
    title: string;
    level: number;
    start: number;
    end: number;
  }[] = [];
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fenceMatch) {
      if (!fence) fence = fenceMatch;
      else if (
        fenceMatch[0] === fence[0] &&
        fenceMatch.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (match?.[1] && match[2]) {
      sections.push({
        title: match[2],
        level: match[1].length,
        start: index,
        end: lines.length,
      });
    }
  }
  for (const section of sections) {
    const next = sections.find(
      (candidate) =>
        candidate.start > section.start && candidate.level <= section.level,
    );
    section.end = next?.start ?? lines.length;
  }
  return { lines, sections };
}

export function parseSpec(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      'Feature specs require YAML frontmatter and a Markdown body.',
    );
  }
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.join('\n'));
  const metadata = specMetadataSchema.parse(document.toJS());
  if (
    new Set(metadata.checks.map((check) => check.id)).size !==
    metadata.checks.length
  ) {
    throw new Error('Acceptance check IDs must be unique.');
  }
  const body = match[2];
  const { sections } = markdownSections(body);
  for (const title of requiredHeadings) {
    if (
      !sections.some(
        (section) => section.level === 2 && section.title === title,
      )
    ) {
      throw new Error(`Missing required spec heading: ${title}`);
    }
  }
  const requirements = [
    ...new Set(
      Array.from(
        body.matchAll(/^\s*[-*]\s+\*\*([A-Z][A-Z0-9]*-\d{3})\b/gm),
        (entry) => nonempty.parse(entry[1]),
      ),
    ),
  ];
  if (!requirements.length)
    throw new Error('Spec has no numbered requirements.');
  return { metadata, body, requirements };
}

export type FeatureSpec = ReturnType<typeof parseSpec>;

export function requireApproval(spec: FeatureSpec): void {
  if (
    spec.metadata.status !== 'approved' ||
    !spec.metadata.approved_by ||
    !spec.metadata.approved_at ||
    spec.metadata.checks.length === 0
  ) {
    throw new Error(
      'Build requires an explicitly approved spec with acceptance checks.',
    );
  }
  if (/\b(?:TBD|NEEDS CLARIFICATION|OPEN BLOCKER)\b/i.test(spec.body)) {
    throw new Error(
      'Resolve blocking placeholders before approving the feature.',
    );
  }
}

const protectedFiles = new Set([
  'AGENTS.md',
  'SPEC.md',
  '.gitignore',
  '.npmrc',
  'eslint.config.mjs',
  'prettier.config.mjs',
  'vitest.config.ts',
  'tsconfig.base.json',
]);

export function validateOwnedPath(file: string): void {
  if (
    file !== path.posix.normalize(file) ||
    file.startsWith('/') ||
    file.startsWith('../') ||
    /[\\:*?[\]{}$\n\r\0]/.test(file) ||
    file.startsWith('-') ||
    file === '.' ||
    file.endsWith('/')
  ) {
    throw new Error(
      `Expected a literal repository-relative file path: ${file}`,
    );
  }
  if (
    protectedFiles.has(file) ||
    [
      '.git',
      '.github',
      '.chainkit',
      'vendor',
      'specs',
      'node_modules',
      'dist',
      'coverage',
    ].some(
      (directory) => file === directory || file.startsWith(`${directory}/`),
    )
  ) {
    throw new Error(`Feature chains cannot own protected path: ${file}`);
  }
}

export function sliceSpec(spec: FeatureSpec, references: string[]): string {
  const { sections, lines } = markdownSections(spec.body);
  const selected = references.map((title) => {
    const matches = sections.filter((section) => section.title === title);
    if (matches.length !== 1) {
      throw new Error(`Spec heading must resolve exactly once: ${title}`);
    }
    const section = matches[0];
    if (!section) throw new Error(`Missing section: ${title}`);
    return section;
  });
  const wanted = new Set<number>();
  for (const section of selected) {
    for (let i = section.start; i < section.end; i++) wanted.add(i);
  }
  return lines.filter((_, index) => wanted.has(index)).join('\n');
}

export function validatePlan(value: unknown, spec: FeatureSpec): Plan {
  const plan = planSchema.parse(value);
  const ids = new Set<string>();
  const coverage = new Set<string>();
  const checks = new Set<string>();
  for (const chunk of plan.chunks) {
    if (ids.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
    ids.add(chunk.id);
    const files = new Set<string>();
    for (const file of chunk.files) {
      validateOwnedPath(file);
      if (files.has(file)) throw new Error(`Duplicate file in chunk: ${file}`);
      files.add(file);
    }
    sliceSpec(spec, chunk.specRefs);
    for (const id of chunk.requirementIds) {
      if (!spec.requirements.includes(id))
        throw new Error(`Unknown requirement: ${id}`);
      coverage.add(id);
    }
    for (const id of chunk.checkIds) {
      if (!spec.metadata.checks.some((check) => check.id === id)) {
        throw new Error(`Unknown approved acceptance check: ${id}`);
      }
      checks.add(id);
    }
  }
  if (spec.requirements.some((id) => !coverage.has(id))) {
    throw new Error('Every requirement must be assigned to a chunk.');
  }
  if (spec.metadata.checks.some((check) => !checks.has(check.id))) {
    throw new Error(
      'Every approved acceptance check must be assigned to a chunk.',
    );
  }
  return plan;
}
