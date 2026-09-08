import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { runReadOnlyCheck } from './checks.js';
import {
  parseSpec,
  requireApproval,
  reviewSchema,
  sliceSpec,
  validatePlan,
} from './contracts.js';
import {
  assertNoSymlinkParents,
  changedFiles,
  fingerprint,
  git,
  requireClean,
  requireFreshBase,
} from './repository.js';
import {
  chunkStateSchema,
  readArtifacts,
  readState,
  runStateSchema,
  writeState,
} from './state.js';
import { verifyVendor } from './vendor.js';

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) });
const factsSchema = z.strictObject({
  pass: z.boolean(),
  fingerprint: z.string(),
  outOfScope: z.array(z.string()),
  checks: z.array(
    z.strictObject({
      id: z.string(),
      command: z.array(z.string()),
      pass: z.boolean(),
      exitCode: z.number().nullable(),
      output: z.string(),
    }),
  ),
});

export function executeStage(operation: string): unknown {
  const state = runStateSchema.parse(readState('run.json'));
  const { cwd } = state;
  if (process.cwd() !== cwd)
    throw new Error('Run state belongs to a different worktree.');
  const spec = parseSpec(state.specText);
  requireApproval(spec);
  if (readFileSync(path.join(cwd, state.specPath), 'utf8') !== state.specText) {
    throw new Error('Approved spec changed during execution.');
  }
  const currentScripts = packageSchema.parse(
    JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')),
  ).scripts;
  for (const [name, command] of Object.entries(state.scripts)) {
    if (currentScripts[name] !== command) {
      throw new Error(
        `Existing npm quality/acceptance script was changed: ${name}`,
      );
    }
  }

  if (operation === 'preflight') {
    requireClean(cwd);
    requireFreshBase(cwd, spec.metadata.base_commit, state.specPath);
    verifyVendor(cwd);
    return { ready: true };
  }

  if (['check-plan', 'plan-decision', 'lock-plan'].includes(operation)) {
    if (fingerprint(cwd) !== state.initialFingerprint) {
      throw new Error('Planning/review stages must not modify the repository.');
    }
    const artifacts = readArtifacts();
    const plan = validatePlan(artifacts['plan'], spec);
    assertNoSymlinkParents(
      cwd,
      plan.chunks.flatMap((chunk) => chunk.files),
    );
    if (operation === 'plan-decision') {
      return reviewSchema.parse(artifacts['planReview']);
    }
    if (operation === 'lock-plan') {
      const verdict = reviewSchema.parse(artifacts['planVerdict']);
      if (!verdict.pass)
        throw new Error('Rejected plan cannot enter implementation.');
      writeState('plan.json', plan);
    }
    return { valid: true };
  }

  const plan = validatePlan(readState('plan.json'), spec);

  if (operation === 'final-gate') {
    requireClean(cwd);
    const results = spec.metadata.checks.map((check) => ({
      id: check.id,
      ...runReadOnlyCheck(cwd, check.command),
    }));
    results.push({
      id: 'repository-quality',
      ...runReadOnlyCheck(cwd, ['npm', 'run', 'check']),
    });
    for (const result of results) {
      process.stdout.write(
        `${result.id}: ${result.pass ? 'PASS' : 'FAIL'}\n${result.output}\n`,
      );
    }
    if (results.some((result) => !result.pass))
      throw new Error('Final acceptance failed.');
    return { automatedAcceptance: 'passed', humanAcceptance: 'pending' };
  }

  if (operation === 'prepare') {
    requireClean(cwd);
    const artifacts = readArtifacts();
    const chunk = z.object({ id: z.string() }).parse(artifacts['chunk']);
    const approved = plan.chunks.find((candidate) => candidate.id === chunk.id);
    if (
      !approved ||
      JSON.stringify(approved) !== JSON.stringify(artifacts['chunk'])
    ) {
      throw new Error('Chunk differs from the reviewed plan.');
    }
    assertNoSymlinkParents(cwd, approved.files);
    writeState('chunk.json', {
      id: chunk.id,
      head: git(cwd, 'rev-parse', 'HEAD'),
      reviewedFingerprint: null,
      pass: false,
    });
    return sliceSpec(spec, approved.specRefs);
  }

  const chunkState = chunkStateSchema.parse(readState('chunk.json'));
  const chunk = plan.chunks.find((candidate) => candidate.id === chunkState.id);
  if (!chunk) throw new Error('No approved chunk is active.');
  if (git(cwd, 'rev-parse', 'HEAD') !== chunkState.head) {
    throw new Error(
      'Only Chainkit may create checkpoint commits between chunks.',
    );
  }
  assertNoSymlinkParents(cwd, chunk.files);
  const outOfScope = changedFiles(cwd).filter(
    (file) => !chunk.files.includes(file),
  );

  const measure = () => {
    const checks = spec.metadata.checks
      .filter((check) => chunk.checkIds.includes(check.id))
      .map((check) => ({
        id: check.id,
        ...runReadOnlyCheck(cwd, check.command),
      }));
    checks.push({
      id: 'format',
      ...runReadOnlyCheck(cwd, ['npm', 'run', 'format:check']),
    });
    return {
      pass: outOfScope.length === 0 && checks.every((check) => check.pass),
      fingerprint: fingerprint(cwd),
      outOfScope,
      checks,
    };
  };

  if (operation === 'measure') return measure();

  if (operation === 'decide') {
    const artifacts = readArtifacts();
    const review = reviewSchema.parse(artifacts['review']);
    const facts = factsSchema.parse(artifacts['facts']);
    if (facts.fingerprint !== fingerprint(cwd)) {
      throw new Error(
        'Reviewer changed the tree or judged a stale measurement.',
      );
    }
    const findings = [...review.findings];
    for (const check of facts.checks.filter((check) => !check.pass)) {
      findings.push({
        id: `check-${check.id}`,
        file: '(acceptance)',
        requirement: check.id,
        problem: check.output,
        remedy: 'Fix the implementation; do not weaken the approved check.',
      });
    }
    if (facts.outOfScope.length) {
      findings.push({
        id: 'file-scope',
        file: facts.outOfScope.join(', '),
        requirement: 'owned-files',
        problem: 'Changes extend beyond this chunk.',
        remedy:
          'Stop and request a revised plan if these changes are necessary.',
      });
    }
    const pass = review.pass && facts.pass;
    writeState('chunk.json', {
      ...chunkState,
      reviewedFingerprint: facts.fingerprint,
      pass,
    });
    return { pass, findings };
  }

  if (operation === 'chunk-gate') {
    if (
      !chunkState.pass ||
      chunkState.reviewedFingerprint !== fingerprint(cwd)
    ) {
      throw new Error(
        'Chunk requires a passing review of its current contents.',
      );
    }
    if (!changedFiles(cwd).length) throw new Error('Chunk made no changes.');
    const facts = measure();
    for (const check of facts.checks) {
      process.stdout.write(
        `${check.id}: ${check.pass ? 'PASS' : 'FAIL'}\n${check.output}\n`,
      );
    }
    if (!facts.pass)
      throw new Error('Chunk failed measured acceptance or ownership.');
    return { pass: true };
  }

  throw new Error(`Unknown chain operation: ${operation}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = executeStage(process.argv[2] ?? '');
    process.stdout.write(
      typeof result === 'string' ? result : JSON.stringify(result),
    );
    process.stdout.write('\n');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
