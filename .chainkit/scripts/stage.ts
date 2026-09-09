import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { runReadOnlyCheck } from './checks.js';
import {
  parseSpec,
  requireApproval,
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

  if (['check-plan', 'check-build-plan', 'lock-plan'].includes(operation)) {
    if (fingerprint(cwd) !== state.initialFingerprint) {
      throw new Error('Planning/review stages must not modify the repository.');
    }
    const artifacts = readArtifacts();
    const artifact = operation === 'check-plan' ? 'plan' : 'buildPlan';
    const plan = validatePlan(artifacts[artifact], spec);
    assertNoSymlinkParents(
      cwd,
      plan.chunks.flatMap((chunk) => chunk.files),
    );
    if (operation === 'lock-plan') {
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
    const checks = [
      {
        id: '_build',
        ...runReadOnlyCheck(cwd, ['npm', 'run', 'build']),
      },
    ];
    if (checks[0]?.pass) {
      const requested = [
        { id: '_typecheck', command: ['npm', 'run', 'typecheck'] },
        { id: '_regressions', command: ['npm', 'test'] },
        ...spec.metadata.checks.filter((check) =>
          chunk.checkIds.includes(check.id),
        ),
        { id: '_format', command: ['npm', 'run', 'format:check'] },
      ];
      const measured = new Set<string>();
      for (const check of requested) {
        const identity = JSON.stringify(check.command);
        if (measured.has(identity)) continue;
        measured.add(identity);
        checks.push({
          id: check.id,
          ...runReadOnlyCheck(cwd, check.command),
        });
      }
    }
    return {
      pass: outOfScope.length === 0 && checks.every((check) => check.pass),
      fingerprint: fingerprint(cwd),
      outOfScope,
      checks,
    };
  };

  if (operation === 'measure') return measure();

  if (operation === 'chunk-gate') {
    const facts = factsSchema.parse(readArtifacts()['facts']);
    if (facts.fingerprint !== fingerprint(cwd))
      throw new Error('Chunk gate received stale measured facts.');
    if (!facts.pass)
      throw new Error('Chunk remains outside ownership or acceptance.');
    if (!changedFiles(cwd).length) throw new Error('Chunk made no changes.');
    const current = measure();
    for (const check of current.checks) {
      process.stdout.write(
        `${check.id}: ${check.pass ? 'PASS' : 'FAIL'}\n${check.output}\n`,
      );
    }
    if (!current.pass)
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
