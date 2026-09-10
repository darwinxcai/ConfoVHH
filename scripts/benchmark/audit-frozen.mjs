// Only prediction coordinates and declared roles enter the frozen geometry engine.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const input = JSON.parse(readFileSync(0, 'utf8'));
const { exportCoordinateRanks } = await import(pathToFileURL(`${input.engine}/scripts/paper/export-coordinate-ranks.mjs`));
const bytes = Buffer.from(input.coordinateBase64, 'base64');
const manifest = {
  schema: 'confovhh-coordinate-rank-input-v1', studyId: 'benchmark-v1',
  generators: [{ id: 'boltz221', scoreName: 'confidence_score', direction: 'higher-better' }],
  attempts: [{ id: input.id, groupId: 'measurement', targetId: 'measurement', generatorId: 'boltz221', status: 'eligible', reason: '' }],
  coordinates: [{ id: input.id, format: 'mmcif', coordinateSha256: input.sha256,
    coordinateBytes: bytes.length, receptorChain: input.receptorChain, vhhChain: input.vhhChain,
    selectedModelId: '1', chainRolesConfirmed: true, producerScore: null }],
};
const result = await exportCoordinateRanks(manifest, new Map([[input.id, bytes]]));
process.stdout.write(result.reports[input.id]);
