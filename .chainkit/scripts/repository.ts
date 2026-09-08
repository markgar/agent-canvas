import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}

export function changedFiles(cwd: string): string[] {
  return [
    ...new Set([
      ...git(cwd, 'diff', '--name-only', '-z', 'HEAD').split('\0'),
      ...git(cwd, 'ls-files', '--others', '--exclude-standard', '-z').split(
        '\0',
      ),
    ]),
  ].filter(Boolean);
}

export function fingerprint(cwd: string): string {
  const hash = createHash('sha256');
  hash.update(git(cwd, 'rev-parse', 'HEAD'));
  hash.update(git(cwd, 'diff', '--binary', 'HEAD'));
  hash.update(git(cwd, 'diff', '--cached', '--binary'));
  const untracked = git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const name of untracked) {
    const file = path.join(cwd, name);
    const stat = lstatSync(file);
    const symbolicLink = stat.isSymbolicLink();
    hash.update(
      JSON.stringify({
        name,
        executable: (stat.mode & 0o111) !== 0,
        symbolicLink,
        content: createHash('sha256')
          .update(symbolicLink ? readlinkSync(file) : readFileSync(file))
          .digest('hex'),
      }),
    );
  }
  return hash.digest('hex');
}

export function requireClean(cwd: string): void {
  if (git(cwd, 'status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Chain builds require a clean, committed worktree.');
  }
}

export function requireFreshBase(
  cwd: string,
  base: string,
  specPath: string,
): void {
  git(cwd, 'merge-base', '--is-ancestor', base, 'HEAD');
  const changes = git(cwd, 'diff', '--name-only', '-z', base, 'HEAD')
    .split('\0')
    .filter((file) => file && file !== specPath);
  if (changes.length) {
    throw new Error(
      `Spec baseline is stale; re-ground and reapprove after changes to: ${changes.join(', ')}`,
    );
  }
}

export function assertNoSymlinkParents(cwd: string, files: string[]): void {
  for (const file of files) {
    const segments = file.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const candidate = path.join(cwd, ...segments.slice(0, i));
      const stat = lstatSync(candidate, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        throw new Error(`Owned paths cannot traverse symlinks: ${file}`);
      }
    }
  }
}
