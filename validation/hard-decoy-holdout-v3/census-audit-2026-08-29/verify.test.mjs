import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

test('bounded census package verifies from its own directory', () => {
  const result = spawnSync(process.execPath, [join(root, 'verify.mjs')], {
    cwd: root,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /13 disposition records, 20 unique PDB entries, zero new components/)
})

test('ledger and state preserve the preregistered stop condition', async () => {
  const state = JSON.parse(await readFile(join(root, 'audit-state.json'), 'utf8'))
  const rows = (await readFile(join(root, 'dispositions.jsonl'), 'utf8'))
    .trimEnd()
    .split('\n')
    .map(JSON.parse)

  assert.equal(state.requiredIndependentComponents, 10)
  assert.equal(state.existingProvisionalComponentCount, 7)
  assert.equal(state.formallyClearedComponentCount, 0)
  assert.equal(state.newIndependentComponentCount, 0)
  assert.equal(state.targetFreezeReady, false)
  assert.ok(rows.every((row) => row.componentEffect !== 'NEW_INDEPENDENT_COMPONENT'))
  assert.ok(rows.every((row) => row.directInterfaceEvidence.coordinatesInspected === false))
})

test('access record fails closed on every forbidden scientific data class', async () => {
  const access = JSON.parse(await readFile(join(root, 'access-state.json'), 'utf8'))
  const forbiddenFlags = [
    'nativeHoldoutCoordinatesAccessed',
    'coordinateFilesDownloaded',
    'coordinateEndpointsRequested',
    'nativeRelativeReceptorVhhPosesInspected',
    'nativeStructuresVisualized',
    'coordinateDerivedContactsCalculated',
    'coordinateDerivedInterfacesCalculated',
    'dockqValuesAccessed',
    'capriLabelsAccessed',
    'fnatIrmsdLrmsdAccessed',
    'confoVhhHoldoutScoresGenerated',
    'candidateGeneratorOutputsAccessed',
    'holdoutPerformanceResultsAccessed',
    'sourceUniverseFrozen',
    'dispositionLedgerComplete',
    'leakageMatricesComplete',
    'targetFreezePermitted',
    'executionAuthorized'
  ]
  for (const field of forbiddenFlags) assert.equal(access[field], false, field)
})
