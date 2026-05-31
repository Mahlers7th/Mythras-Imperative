/**
 * scripts/unpack-all.mjs
 *
 * Extract all compendium packs from packs/ LevelDB into _source/ YAML.
 * Run if you've edited packs directly in Foundry and need to re-extract:
 * `npm run unpack`
 *
 * Requires: @foundryvtt/foundryvtt-cli (devDependency)
 */

import { extractPack } from '@foundryvtt/foundryvtt-cli';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const SOURCE_DIR = 'packs';
const OUTPUT_DIR = '_source';

const packs = readdirSync(SOURCE_DIR).filter(name =>
  statSync(join(SOURCE_DIR, name)).isDirectory()
);

console.log(`Unpacking ${packs.length} compendium pack(s)...\n`);

for (const packName of packs) {
  const inputPath  = join(SOURCE_DIR, packName);
  const outputPath = join(OUTPUT_DIR, packName);
  console.log(`  ${packName}`);
  await extractPack(inputPath, outputPath, { yaml: true, clean: false });
}

console.log('\nDone.');
