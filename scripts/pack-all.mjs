/**
 * scripts/pack-all.mjs
 *
 * Rebuild all compendium packs from _source/ YAML into packs/.
 * Run before tagging a release: `npm run pack`
 *
 * Requires: @foundryvtt/foundryvtt-cli (devDependency)
 */

import { compilePack } from '@foundryvtt/foundryvtt-cli';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const SOURCE_DIR = '_source';
const OUTPUT_DIR = 'packs';

const packs = readdirSync(SOURCE_DIR).filter(name =>
  statSync(join(SOURCE_DIR, name)).isDirectory()
);

console.log(`Packing ${packs.length} compendium pack(s)...\n`);

for (const packName of packs) {
  const inputPath  = join(SOURCE_DIR, packName);
  const outputPath = join(OUTPUT_DIR, packName);
  console.log(`  ${packName}`);
  await compilePack(inputPath, outputPath, { yaml: true, recursive: false });
}

console.log('\nDone.');
