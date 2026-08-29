#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const readText = async (name) => readFile(join(root, name), 'utf8')
const readJson = async (name) => JSON.parse(await readText(name))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const state = await readJson('audit-state.json')
const access = await readJson('access-state.json')
const provenance = await readJson('provenance.json')
const ledgerText = await readText('dispositions.jsonl')
const rows = ledgerText.trimEnd().split('\n').map((line, index) => {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`dispositions.jsonl line ${index + 1}: ${error.message}`)
  }
})

assert.equal(state.requiredIndependentComponents, 10)
assert.equal(state.existingProvisionalComponentCount, 7)
assert.equal(state.newIndependentComponentCount, 0)
assert.equal(state.formallyClearedComponentCount, 0)
assert.equal(state.reviewedLedgerRecordCount, 13)
assert.equal(state.reviewedPdbEntryCount, 20)
assert.equal(state.sourceUniverseFrozen, false)
assert.equal(state.dispositionLedgerComplete, false)
assert.equal(state.targetFreezeReady, false)
assert.equal(state.existingProvisionalComponents.length, 7)

for (const [key, value] of Object.entries(access)) {
  if (/Accessed$|Downloaded$|Requested$|Inspected$|Visualized$|Calculated$|Generated$|Authorized$|Complete$|Frozen$|Permitted$/.test(key) && key !== 'metadataOnly') {
    assert.equal(value, false, `${key} must remain false`)
  }
}
assert.equal(access.metadataOnly, true)
assert.equal(access.rawHttpResponseBytesPreserved, false)
assert.equal(access.repeatResponseEqualityRecorded, false)

assert.equal(provenance.historicalFourTermReproduction.union.count, 2065)
assert.equal(provenance.historicalFourTermReproduction.intersection.count, 287)
assert.equal(provenance.accessionCenteredRecentReleaseSweep.gpcrdbReceptorList.recordCount, 2471)
assert.equal(provenance.accessionCenteredRecentReleaseSweep.union.count, 873)
assert.equal(provenance.historicalFourTermReproduction.rawResponsesPreservedInThisPackage, false)
assert.equal(provenance.accessionCenteredRecentReleaseSweep.rawResponsesPreservedInThisPackage, false)
assert.ok(provenance.publicMainContext.commits.every((item) => item.completedTargetDispositions === false))

assert.equal(rows.length, 13)
const pdbIds = []
for (const [index, row] of rows.entries()) {
  const label = `ledger row ${index + 1}`
  assert.equal(row.schemaVersion, '1.0.0', `${label} schemaVersion`)
  assert.equal(row.metadataLicense.id, 'CC0-1.0', `${label} metadata license`)
  assert.equal(row.metadataLicense.url, 'https://www.wwpdb.org/about/usage-policies', `${label} license URL`)
  assert.equal(row.publication.licenseStatus, 'not-assessed', `${label} publication license status`)
  assert.equal(row.directInterfaceEvidence.coordinatesInspected, false, `${label} coordinate attestation`)
  assert.ok(Array.isArray(row.pdbIds) && row.pdbIds.length > 0, `${label} PDB IDs`)
  assert.equal(row.pdbUrls.length, row.pdbIds.length, `${label} PDB URL count`)
  for (const pdbId of row.pdbIds) {
    assert.match(pdbId, /^[0-9][A-Z0-9]{3}$/, `${label} PDB ID`)
    assert.equal(row.releaseDates[pdbId]?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0], row.releaseDates[pdbId], `${label} release date`)
    assert.ok(row.pdbUrls.includes(`https://www.rcsb.org/structure/${pdbId}`), `${label} PDB URL`)
    pdbIds.push(pdbId)
  }
  assert.ok(Array.isArray(row.vhhEntities) && row.vhhEntities.length > 0, `${label} VHH entities`)
  for (const entity of row.vhhEntities) {
    assert.ok(Number.isInteger(entity.depositedLength) && entity.depositedLength > 0, `${label} deposited length`)
    assert.match(entity.sequenceSha256, /^[0-9a-f]{64}$/, `${label} sequence SHA-256`)
    assert.ok(entity.pdbIds.every((id) => row.pdbIds.includes(id)), `${label} VHH entity PDB IDs`)
  }
}

assert.equal(new Set(pdbIds).size, 20)
assert.equal(pdbIds.length, 20)

const prohibitedExtensions = /\.(?:pdb|cif|mmcif)(?:\.gz)?$/i
for (const name of await readdir(root)) {
  assert.equal(prohibitedExtensions.test(name), false, `coordinate-like file is forbidden: ${name}`)
}

const checksumLines = (await readText('checksums.sha256')).trimEnd().split('\n')
const expectedChecksumFiles = [
  'README.md',
  'access-state.json',
  'audit-state.json',
  'dispositions.jsonl',
  'provenance.json',
  'verify.mjs',
  'verify.test.mjs'
]
assert.deepEqual(checksumLines.map((line) => line.slice(66)), expectedChecksumFiles)
for (const line of checksumLines) {
  const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/)
  assert.ok(match, `invalid checksum line: ${line}`)
  const [, expected, name] = match
  const actual = sha256(await readFile(join(root, name)))
  assert.equal(actual, expected, `checksum mismatch: ${name}`)
}

console.log(`verified ${basename(root)}: ${rows.length} disposition records, ${pdbIds.length} unique PDB entries, zero new components, no label/coordinate access`)
