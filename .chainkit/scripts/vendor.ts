import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const manifestSchema = z.strictObject({
  repository: z.literal('markgar/chainkit'),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.literal('MIT'),
  files: z.record(
    z.string(),
    z.strictObject({ sha256: z.string(), executable: z.boolean() }),
  ),
});

function inventory(directory: string, prefix = '') {
  const files: Record<string, { sha256: string; executable: boolean }> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, inventory(file, name));
    else if (entry.isFile()) {
      files[name] = {
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        executable: (statSync(file).mode & 0o111) !== 0,
      };
    } else throw new Error(`Unexpected non-file in vendor snapshot: ${name}`);
  }
  return files;
}

export function verifyVendor(root: string): void {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(path.join(root, '.chainkit/vendor.json'), 'utf8')),
  );
  const actual = inventory(path.join(root, 'vendor/chainkit'));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error(
      'Vendored Chainkit differs from its pinned inventory; do not patch vendor/.',
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = process.cwd();
  const revision = process.argv[3];
  if (process.argv[2] === 'record' && revision) {
    const manifest = manifestSchema.parse({
      repository: 'markgar/chainkit',
      revision,
      license: 'MIT',
      files: inventory(path.join(root, 'vendor/chainkit')),
    });
    writeFileSync(
      path.join(root, '.chainkit/vendor.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } else if (process.argv[2] === 'check') verifyVendor(root);
  else
    throw new Error(
      'Usage: npm run chainkit:vendor -- record <commit> | check',
    );
}
