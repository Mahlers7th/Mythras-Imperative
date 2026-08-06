/**
 * tests/frozen-api.test.js
 *
 * REPO HYGIENE (batch-hygiene-prompt.md, H7): frozen-api-updated.md's own
 * header admits its "update the doc in the same change" rule has been
 * missed twice historically, caught only by manual doc-sync passes. This
 * turns the manual "count this table's rows against the runtime" discipline
 * into an automated check.
 *
 * Pure text-level check, no Foundry globals: reads mythras.mjs as text,
 * extracts the member names from the `game.system.api = Object.freeze({...})`
 * assembly block with a regex, and asserts set-equality against
 * frozen-api.json's manifest. This can only validate MEMBERSHIP (a name was
 * added/removed without updating the manifest) — it cannot validate
 * signatures. Signature validation is a separate, harder problem left for
 * the node editor's own conformance tests (see the design brief).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function extractApiMembers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'mythras.mjs'), 'utf8');

  const startMarker = 'game.system.api = Object.freeze({';
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(
      "Could not find 'game.system.api = Object.freeze({' in mythras.mjs — has the assembly block been renamed or restructured?"
    );
  }
  const bodyStart = start + startMarker.length;
  const end = source.indexOf('\n  });', bodyStart);
  if (end === -1) {
    throw new Error(
      "Found the api assembly block's opening but not its closing '});' in mythras.mjs — regex assumption about its shape no longer holds."
    );
  }
  const body = source.slice(bodyStart, end);

  // Strip // line comments before extracting identifiers, so comment prose
  // (which may itself mention member-like words) can't produce false matches.
  const withoutComments = body
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n');

  // Each real entry is a bare identifier used as ES2015 shorthand property
  // syntax (`memberName,` or `memberName\n}`) — no `key: value` pairs exist
  // in this block today, so a bare-identifier-per-line extraction is exact.
  const members = [];
  for (const rawLine of withoutComments.split('\n')) {
    const line = rawLine.trim().replace(/,$/, '');
    if (!line) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(line)) {
      throw new Error(
        `frozen-api.test.js's extraction regex didn't recognize this line inside the api assembly block: "${rawLine}". The block's shape may have changed (e.g. a computed or renamed property) — update the extraction logic, don't just widen the regex blindly.`
      );
    }
    members.push(line);
  }
  return members;
}

function readManifest() {
  const manifestPath = path.join(REPO_ROOT, 'frozen-api.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.members;
}

describe('frozen-api.json stays in sync with game.system.api', () => {
  test('manifest member set exactly matches the runtime assembly block in mythras.mjs', () => {
    const runtimeMembers = extractApiMembers();
    const manifestMembers = readManifest();

    const runtimeSet = new Set(runtimeMembers);
    const manifestSet = new Set(manifestMembers);

    const missingFromManifest = runtimeMembers.filter(m => !manifestSet.has(m));
    const staleInManifest = manifestMembers.filter(m => !runtimeSet.has(m));

    expect({ missingFromManifest, staleInManifest }).toEqual({
      missingFromManifest: [],
      staleInManifest: [],
    });
  });

  test('neither the runtime block nor the manifest has internal duplicates', () => {
    const runtimeMembers = extractApiMembers();
    const manifestMembers = readManifest();

    expect(runtimeMembers.length).toBe(new Set(runtimeMembers).size);
    expect(manifestMembers.length).toBe(new Set(manifestMembers).size);
  });
});
