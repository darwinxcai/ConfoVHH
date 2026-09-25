/** Experimental source-first policies. No reference/outcome inputs or fitting. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateManifest } from '../external-ranking/score.mjs';

export const BASE_ARMS = Object.freeze(['source-only', 'source-validity', 'source-validity-cdr-exact']);
export const CALIBRATED_ARM = 'source-validity-cdr-calibrated';
export const check = (ok, message) => { if (!ok) throw new Error(message); };
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const exact = (value, keys) => check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'Unexpected or absent fields');
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,159}$/u.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');

export function rejectOutcomeKeys(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    check(!/(?:dockq|fnat|(^|_)[il]?rmsd?$|nativecontact|native_contact|groundtruth|ground_truth|__proto__|constructor|prototype)/iu.test(key), 'Outcome-like or unsafe input key');
    rejectOutcomeKeys(child);
  }
}

export function validateBinding(binding) {
  exact(binding, ['path', 'bytes', 'sha256']);
  check(typeof binding.path === 'string' && binding.path.length > 0 && !binding.path.startsWith('/') && !binding.path.includes('\\') && !binding.path.split('/').includes('..'), 'Unsafe artifact path');
  check(Number.isSafeInteger(binding.bytes) && binding.bytes > 0 && binding.bytes <= 16_000_000 && digest(binding.sha256), 'Invalid artifact binding');
}

export function validateInput(input, sourceManifest = null) {
  check(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Ambient Node injection must be absent');
  exact(input, ['schema', 'studyId', 'evaluationRole', 'sourceScoreReceipt', 'producerProfiles', 'setPolicies']);
  rejectOutcomeKeys(input);
  check(input.schema === 'confovhh-source-first-input-v3' && identity(input.studyId), 'Invalid source-first identity');
  check(['development', 'sealed-validation'].includes(input.evaluationRole), 'Invalid evaluation role');
  validateBinding(input.sourceScoreReceipt);
  check(Array.isArray(input.producerProfiles) && input.producerProfiles.length > 0, 'Missing producer profiles');
  const profiles = new Map();
  for (const profile of input.producerProfiles) {
    exact(profile, ['generatorId', 'version', 'scoreContext', 'scoreProvenance', 'calibration']);
    check([profile.generatorId, profile.version, profile.scoreContext].every(identity) && !profiles.has(profile.generatorId), 'Invalid or duplicate producer profile');
    if (profile.scoreProvenance !== null) validateBinding(profile.scoreProvenance);
    if (profile.calibration !== null) {
      validateBinding(profile.calibration);
      check(profile.version !== 'unknown' && profile.scoreProvenance !== null, 'Calibrated tolerance requires a known version and bound score provenance');
    }
    profiles.set(profile.generatorId, profile);
  }
  check(Array.isArray(input.setPolicies) && input.setPolicies.length > 0, 'Missing set policies');
  const sets = new Map();
  for (const policy of input.setPolicies) {
    exact(policy, ['setId', 'biologicalGroupId', 'receptorSequenceSha256', 'vhhSequenceSha256']);
    check(identity(policy.setId) && identity(policy.biologicalGroupId) && !sets.has(policy.setId), 'Invalid or duplicate set policy');
    check([policy.receptorSequenceSha256, policy.vhhSequenceSha256].every(value => value === null || digest(value)), 'Invalid optional role sequence hash');
    sets.set(policy.setId, policy);
  }
  if (sourceManifest !== null) {
    const source = validateManifest(sourceManifest);
    check(input.studyId === sourceManifest.studyId && isDeepStrictEqual([...profiles.keys()].sort(), [...source.generators.keys()].sort()) && isDeepStrictEqual([...sets.keys()].sort(), [...source.sets.keys()].sort()), 'Source/profile/set membership differs');
  }
  return { profiles, sets };
}

export function validateCalibration(record, profile, generator, input) {
  exact(record, ['schema', 'calibrationId', 'generatorId', 'producerVersion', 'scoreContext', 'scoreName', 'direction', 'maximumPreferredScoreGap', 'developmentGroupIds', 'selectionRule', 'frozenAtUtc', 'evidenceSha256']);
  rejectOutcomeKeys(record);
  check(record.schema === 'confovhh-source-gap-freeze-v1' && identity(record.calibrationId), 'Invalid calibration identity');
  check(record.generatorId === generator.id && record.producerVersion === profile.version && record.scoreContext === profile.scoreContext && record.scoreName === generator.scoreName && record.direction === generator.direction, 'Calibration producer/version/context/score identity mismatch');
  check(finite(record.maximumPreferredScoreGap) && record.maximumPreferredScoreGap >= 0, 'Invalid score-gap tolerance');
  check(record.selectionRule === 'development-selected-tolerance-not-confidence-uncertainty', 'Tolerance must not be described as measured confidence uncertainty');
  check(Array.isArray(record.developmentGroupIds) && record.developmentGroupIds.length > 0 && record.developmentGroupIds.every(identity) && new Set(record.developmentGroupIds).size === record.developmentGroupIds.length, 'Invalid calibration development groups');
  check(typeof record.frozenAtUtc === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/u.test(record.frozenAtUtc) && Number.isFinite(Date.parse(record.frozenAtUtc)) && digest(record.evidenceSha256), 'Calibration freeze evidence missing');
  if (input.evaluationRole === 'sealed-validation') check(input.setPolicies.every(policy => !record.developmentGroupIds.includes(policy.biologicalGroupId)), 'Calibration development group overlaps sealed validation');
  return record;
}

const diagnosticKeys = 'selectedModelId malformedAtomRecords duplicateAtomRecords residueNameConflicts zeroOccupancyAtomRecords ignoredHydrogens ignoredAlternateLocations unsupportedResidueRecords'.split(' ');

/** Backbone distances are observations only, including across virtual chain joins. */
function backboneDiagnostics(chain) {
  const distances = [];
  for (let i = 1; i < chain.residues.length; i += 1) {
    const previous = chain.residues[i - 1], current = chain.residues[i];
    if (current.number !== previous.number + 1 || current.insertionCode || previous.insertionCode) continue;
    const a = previous.atoms.find(atom => atom.name === 'CA'), b = current.atoms.find(atom => atom.name === 'CA');
    if (a && b) distances.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  const ordered = [...distances].sort((a, b) => a - b), n = ordered.length;
  return { chainId: chain.id, evaluatedAdjacentNumberedCaPairs: n, distanceGreaterThan5AngstromCount: distances.filter(d => d > 5).length,
    maximumDistanceAngstrom: n ? ordered[n - 1] : null, medianDistanceAngstrom: n ? (ordered[Math.floor((n - 1) / 2)] + ordered[Math.floor(n / 2)]) / 2 : null,
    interpretation: 'Diagnostic only; numeric adjacency can cross construct or virtual-chain breaks; never used by validity or ranking' };
}

export function invalidValidity(reasonCode, error = '', status = 'invalid') {
  return { status, reasonCodes: [reasonCode], error, roleIdentityScope: 'unavailable', parserDiagnostics: null, sequenceChecks: { receptor: 'unavailable', vhh: 'unavailable' }, sequenceSha256: { receptor: null, vhh: null }, backboneDiagnostics: [] };
}

export function assessValidity(structure, set, policy) {
  const reasons = [];
  const selected = [set.receptorChain, set.vhhChain].map(id => structure.chains.find(chain => chain.id === id));
  if (set.receptorChain === set.vhhChain || selected.some(chain => !chain || chain.atomCount <= 0)) return invalidValidity('inconsistent-or-absent-chain-roles');
  if (structure.selectedModelId !== set.selectedModelId) reasons.push('selected-model-identity-mismatch');
  if (structure.malformedAtomRecords > 0) reasons.push('malformed-atom-records');
  if (structure.duplicateAtomRecords > 0) reasons.push('duplicate-atom-identities');
  if (structure.residueNameConflicts > 0) reasons.push('conflicting-residue-identities');
  if (selected.some(chain => chain.residues.some(residue => residue.atoms.some(atom => ![atom.x, atom.y, atom.z].every(finite))))) reasons.push('nonfinite-selected-coordinate');
  const sequenceSha256 = { receptor: hash(selected[0].sequence), vhh: hash(selected[1].sequence) };
  const sequenceChecks = {};
  for (const [role, expected] of [['receptor', policy.receptorSequenceSha256], ['vhh', policy.vhhSequenceSha256]]) {
    sequenceChecks[role] = expected === null ? 'not-supplied' : expected === sequenceSha256[role] ? 'matched' : 'mismatch';
    if (sequenceChecks[role] === 'mismatch') reasons.push(role + '-prediction-sequence-mismatch');
  }
  const diagnostics = Object.fromEntries(diagnosticKeys.map(key => [key, structure[key]]));
  check(diagnosticKeys.slice(1).every(key => Number.isSafeInteger(diagnostics[key]) && diagnostics[key] >= 0), 'Invalid parser diagnostic');
  return { status: reasons.length ? 'invalid' : 'valid', reasonCodes: reasons, error: '',
    roleIdentityScope: 'Explicit selected chain identifiers/presence; only supplied prediction-side sequence hashes verify sequence roles; numbering is not a role validator',
    parserDiagnostics: diagnostics, sequenceChecks, sequenceSha256, backboneDiagnostics: selected.map(backboneDiagnostics) };
}

export function emptyCdr(reason) {
  return { status: 'unavailable', numberingStatus: null, paratopeProxyShare: null, reason, components: null };
}

export function decomposeCdr(audit) {
  rejectOutcomeKeys(audit);
  check(Number.isSafeInteger(audit.contactPairCount) && audit.contactPairCount >= 0 && Array.isArray(audit.contacts) && audit.contacts.length === audit.contactPairCount, 'CDR contact inventory mismatch');
  const pairs = new Set();
  let cdr = 0, framework = 0, unnumbered = 0;
  for (const contact of audit.contacts) {
    const key = `${contact.receptorResidue}\u0000${contact.vhhResidue}`;
    check(!pairs.has(key), 'Duplicate CDR contact pair'); pairs.add(key);
    if (/^CDR[123]-IMGT$/u.test(contact.vhhRegion)) cdr += 1;
    else if (/^FR[1234]-IMGT$/u.test(contact.vhhRegion)) framework += 1;
    else { check(contact.vhhRegion === 'Unnumbered', 'Unknown numbered contact region'); unnumbered += 1; }
  }
  const total = audit.contacts.length, numbered = audit.vhhNumbering?.status === 'numbered';
  const p = total > 0 && numbered ? cdr / total : null;
  check(audit.paratopeProxyShare === p, 'CDR share differs from frozen audit');
  return { status: p === null ? 'unavailable' : 'available', numberingStatus: audit.vhhNumbering?.status ?? null, paratopeProxyShare: p,
    reason: p === null ? (total === 0 ? 'No contacting residue pairs; no CDR share is defined' : 'Optional IMGT numbering unavailable') : '',
    components: { contactPairs: total, cdrContactPairs: cdr, frameworkContactPairs: framework, unnumberedContactPairs: unnumbered,
      cdrShareOfTotal: p, frameworkShareOfTotal: total && numbered ? framework / total : null, unnumberedShareOfTotal: total ? unnumbered / total : null,
      cdrShareAmongNumberedContacts: numbered && cdr + framework > 0 ? cdr / (cdr + framework) : null,
      interpretation: 'FR1-4 and CDR1-3 are engine-numbered regions; unnumbered contacts may be extensions or unassigned residues. Only total-interface CDR share P is used; other components are diagnostic.' } };
}

export function validateFeature(feature, attempt, generator) {
  exact(feature, ['id', 'setId', 'generatorId', 'producerStatus', 'coordinateSha256', 'sourceAuditSha256', 'contactEvidence', 'source', 'validity', 'interface', 'cdr']);
  rejectOutcomeKeys(feature);
  check(feature.id === attempt.id && feature.setId === attempt.setId && feature.generatorId === attempt.generatorId && feature.producerStatus === attempt.status && feature.coordinateSha256 === (attempt.coordinate?.sha256 ?? null), 'Feature identity differs');
  check(feature.sourceAuditSha256 === null || digest(feature.sourceAuditSha256), 'Invalid audit digest');
  if (feature.contactEvidence !== null) {
    exact(feature.contactEvidence, ['kind', 'sha256']);
    check(['full-audit', 'standalone-contact'].includes(feature.contactEvidence.kind) && digest(feature.contactEvidence.sha256), 'Invalid contact evidence binding');
    check(feature.contactEvidence.kind === 'full-audit' ? feature.contactEvidence.sha256 === feature.sourceAuditSha256 : feature.sourceAuditSha256 === null && feature.validity.status === 'valid', 'Contact evidence kind contradicts full-audit or validity state');
  }
  exact(feature.source, ['status', 'rawValue', 'preferredValue', 'reason', 'binding']);
  check(isDeepStrictEqual(feature.source.binding, attempt.producerScore), 'Source binding differs');
  check(['present', 'missing', 'invalid', 'not-produced'].includes(feature.source.status), 'Invalid source disposition');
  const sign = generator.direction === 'lower-better' ? -1 : 1;
  check(feature.source.status === 'present' ? finite(feature.source.rawValue) && feature.source.preferredValue === sign * feature.source.rawValue && feature.source.reason === '' : feature.source.rawValue === null && feature.source.preferredValue === null && typeof feature.source.reason === 'string' && feature.source.reason.length > 0, 'Invalid source scalar or missingness');
  exact(feature.validity, ['status', 'reasonCodes', 'error', 'roleIdentityScope', 'parserDiagnostics', 'sequenceChecks', 'sequenceSha256', 'backboneDiagnostics']);
  check(['valid', 'invalid', 'not-produced'].includes(feature.validity.status) && Array.isArray(feature.validity.reasonCodes) && (feature.validity.status === 'valid' ? feature.validity.reasonCodes.length === 0 : feature.validity.reasonCodes.length > 0), 'Invalid integrity disposition');
  exact(feature.validity.sequenceChecks, ['receptor', 'vhh']);
  exact(feature.validity.sequenceSha256, ['receptor', 'vhh']);
  if (feature.validity.parserDiagnostics !== null) {
    exact(feature.validity.parserDiagnostics, diagnosticKeys);
    check(diagnosticKeys.slice(1).every(key => Number.isSafeInteger(feature.validity.parserDiagnostics[key]) && feature.validity.parserDiagnostics[key] >= 0), 'Invalid parser diagnostic value');
  }
  if (feature.validity.status === 'valid') check(feature.validity.parserDiagnostics !== null && ['malformedAtomRecords', 'duplicateAtomRecords', 'residueNameConflicts'].every(key => feature.validity.parserDiagnostics[key] === 0) && Object.values(feature.validity.sequenceChecks).every(value => ['matched', 'not-supplied'].includes(value)) && Object.values(feature.validity.sequenceSha256).every(digest), 'Valid integrity state contradicts hard diagnostics');
  check((attempt.status !== 'generated') === (feature.source.status === 'not-produced') && (attempt.status !== 'generated') === (feature.validity.status === 'not-produced'), 'Producer status contradicts source or validity disposition');
  exact(feature.interface, ['status', 'contactPairCount']);
  check(['contacting', 'no-contact', 'unavailable', 'invalid-input', 'not-produced'].includes(feature.interface.status), 'Invalid interface disposition');
  check(feature.interface.contactPairCount === null || Number.isSafeInteger(feature.interface.contactPairCount) && feature.interface.contactPairCount >= 0, 'Invalid contact count');
  check(feature.interface.status !== 'contacting' || feature.interface.contactPairCount > 0, 'Contacting state without contacts');
  check(feature.interface.status !== 'no-contact' || feature.interface.contactPairCount === 0, 'No-contact state differs');
  check(feature.validity.status === 'valid' ? ['contacting', 'no-contact', 'unavailable'].includes(feature.interface.status) : feature.interface.status === (feature.validity.status === 'invalid' ? 'invalid-input' : 'not-produced'), 'Interface state contradicts validity');
  exact(feature.cdr, ['status', 'numberingStatus', 'paratopeProxyShare', 'reason', 'components']);
  check(['available', 'unavailable'].includes(feature.cdr.status), 'Invalid CDR disposition');
  check(feature.cdr.status === 'available' ? feature.cdr.numberingStatus === 'numbered' && finite(feature.cdr.paratopeProxyShare) && feature.cdr.paratopeProxyShare >= 0 && feature.cdr.paratopeProxyShare <= 1 && feature.cdr.reason === '' : feature.cdr.paratopeProxyShare === null && typeof feature.cdr.reason === 'string' && feature.cdr.reason.length > 0, 'Invalid optional CDR feature');
  if (feature.cdr.components !== null) {
    const c = feature.cdr.components;
    exact(c, ['contactPairs', 'cdrContactPairs', 'frameworkContactPairs', 'unnumberedContactPairs', 'cdrShareOfTotal', 'frameworkShareOfTotal', 'unnumberedShareOfTotal', 'cdrShareAmongNumberedContacts', 'interpretation']);
    check(['contactPairs', 'cdrContactPairs', 'frameworkContactPairs', 'unnumberedContactPairs'].every(key => Number.isSafeInteger(c[key]) && c[key] >= 0) && c.contactPairs === c.cdrContactPairs + c.frameworkContactPairs + c.unnumberedContactPairs && c.contactPairs === feature.interface.contactPairCount, 'CDR component inventory differs');
    check(c.cdrShareOfTotal === feature.cdr.paratopeProxyShare, 'CDR component P differs');
  }
  if (feature.cdr.status === 'available') check(feature.interface.status === 'contacting' && feature.contactEvidence !== null && feature.cdr.components !== null && feature.cdr.paratopeProxyShare === feature.cdr.components.cdrContactPairs / feature.cdr.components.contactPairs, 'CDR feature lacks contacting evidence/component support');
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] === null) return 1;
    if (b[i] === null) return -1;
    return a[i] > b[i] ? -1 : 1;
  }
  return 0;
}

/** Anchored score blocks avoid nontransitive pairwise "near-tie" comparisons. */
export function sourceBlocks(features, maximumGap) {
  check(finite(maximumGap) && maximumGap >= 0, 'Invalid maximum source gap');
  const sorted = [...features].sort((a, b) => b.source.preferredValue - a.source.preferredValue || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = [];
  for (const feature of sorted) {
    const previous = groups.at(-1);
    if (!previous || previous.anchor - feature.source.preferredValue > maximumGap) groups.push({ anchor: feature.source.preferredValue, members: [feature] });
    else previous.members.push(feature);
  }
  return groups;
}

export function rankSourceFirst(data) {
  exact(data, ['input', 'sourceManifest', 'features', 'calibrations']);
  const { input, sourceManifest, features, calibrations } = data;
  const { profiles, sets } = validateInput(input, sourceManifest);
  check(calibrations && typeof calibrations === 'object' && !Array.isArray(calibrations), 'Invalid calibration map');
  const generators = new Map(sourceManifest.generators.map(g => [g.id, g]));
  const expectedCalibrations = input.producerProfiles.filter(p => p.calibration !== null).map(p => p.generatorId).sort();
  check(isDeepStrictEqual(Object.keys(calibrations).sort(), expectedCalibrations), 'Calibration membership differs');
  for (const [id, record] of Object.entries(calibrations)) validateCalibration(record, profiles.get(id), generators.get(id), input);
  check(Array.isArray(features) && features.length === sourceManifest.attempts.length && new Set(features.map(f => f.id)).size === features.length, 'Feature/attempt membership differs');
  const byId = new Map(features.map(f => [f.id, f]));
  for (const attempt of sourceManifest.attempts) { check(byId.has(attempt.id), 'Missing planned feature'); validateFeature(byId.get(attempt.id), attempt, generators.get(attempt.generatorId)); }
  const arms = expectedCalibrations.length ? [...BASE_ARMS, CALIBRATED_ARM] : [...BASE_ARMS], ranks = [], blocks = [];
  for (const setId of [...sets.keys()].sort()) {
    const planned = sourceManifest.attempts.filter(a => a.setId === setId).map(a => byId.get(a.id)).sort((a, b) => a.id < b.id ? -1 : 1);
    const generatorId = planned[0].generatorId, profile = profiles.get(generatorId), generator = generators.get(generatorId);
    for (const arm of arms) {
      const useValidity = arm !== 'source-only', useCdr = arm.includes('-cdr-');
      const calibration = arm === CALIBRATED_ARM ? calibrations[generatorId] ?? null : null;
      const maximumGap = calibration?.maximumPreferredScoreGap ?? 0;
      const eligible = planned.filter(f => f.producerStatus === 'generated' && (!useValidity || f.validity.status === 'valid'));
      const missing = eligible.filter(f => f.source.status !== 'present');
      const scored = eligible.filter(f => f.source.status === 'present');
      const rows = planned.map(f => {
        const accepted = eligible.includes(f), hasScore = f.source.status === 'present';
        return { id: f.id, key: accepted && hasScore ? [f.source.preferredValue] : null, rank: null,
          status: accepted ? hasScore ? 'scored' : 'unavailable' : 'excluded', reason: accepted ? hasScore ? '' : f.source.reason : f.producerStatus !== 'generated' ? 'Source attempt did not produce a candidate' : f.validity.reasonCodes.join('; '),
          eligible: accepted, sourceStatus: f.source.status, validityStatus: f.validity.status, interfaceStatus: f.interface.status,
          cdrAction: useCdr ? 'not-applied' : 'not-used' };
      });
      const rowMap = new Map(rows.map(row => [row.id, row]));
      // Missing source on an eligible candidate prevents selection and CDR block
      // construction. Invalid candidates never poison the valid eligible pool.
      if (useCdr && missing.length === 0) for (const [index, block] of sourceBlocks(scored, maximumGap).entries()) {
        const missingOptional = block.members.filter(f => f.cdr.status !== 'available');
        const applyCdr = block.members.length > 1 && missingOptional.length === 0;
        const action = block.members.length === 1 ? 'source-singleton' : applyCdr ? 'cdr-rerank' : 'fallback-source-optional-cdr-unavailable';
        for (const feature of block.members) {
          const row = rowMap.get(feature.id);
          row.key = [block.anchor, applyCdr ? feature.cdr.paratopeProxyShare : null, feature.source.preferredValue]; row.cdrAction = action;
        }
        blocks.push({ setId, arm, blockIndex: index, sourceAnchor: block.anchor, minimumPreferredSource: Math.min(...block.members.map(f => f.source.preferredValue)), maximumPreferredScoreGap: maximumGap,
          ids: block.members.map(f => f.id).sort(), action, optionalUnavailableIds: missingOptional.map(f => f.id).sort() });
      }
      const ordered = rows.filter(row => row.key !== null).sort((a, b) => compareKeys(a.key, b.key));
      let rank = 0, previous = null;
      for (const row of ordered) { if (previous === null || compareKeys(previous, row.key) !== 0) rank += 1; row.rank = rank; previous = row.key; }
      const complete = eligible.length > 0 && missing.length === 0;
      const reason = eligible.length === 0 ? (useValidity && planned.some(f => f.producerStatus === 'generated') ? 'No valid candidate remains; selection unavailable' : 'No produced candidate is available') : missing.length ? 'At least one eligible candidate lacks a usable source score; selection unavailable' : '';
      const selected = complete ? rows.filter(row => row.rank === 1).map(row => row.id).sort() : [];
      const valid = planned.filter(f => f.producerStatus === 'generated' && f.validity.status === 'valid');
      const interfaceState = valid.length === 0 ? 'no-valid-inputs' : valid.every(f => f.interface.status === 'no-contact') ? 'unsupported-all-no-contact' : valid.some(f => f.interface.status === 'contacting') ? 'contacting-candidates-present' : 'unavailable';
      ranks.push({ setId, arm, scoreName: generator.scoreName, direction: generator.direction, status: complete ? 'ranked' : 'abstain', reason, selected, rows,
        selectionPolicy: { sourceDirection: generator.direction, producerVersion: profile.version, scoreContext: profile.scoreContext,
          validityApplied: useValidity, optionalCdrReranking: useCdr, maximumPreferredScoreGap: useCdr ? maximumGap : null,
          toleranceMode: !useCdr ? 'not-used' : calibration ? 'development-selected-tolerance-not-confidence-uncertainty' : arm === CALIBRATED_ARM ? 'fallback-exact-no-calibration' : 'exact-source-ties', calibrationId: calibration?.calibrationId ?? null,
          sourceTieRule: 'Exact keys; IDs serialize only; source score is preserved within equal-P or optional-feature fallback blocks',
          missingOptionalFeature: 'Entire source block retains source order when any member lacks optional CDR data', missingSource: 'Abstain selection when any eligible candidate lacks source; keep every planned row' },
        coverage: { plannedCount: planned.length, producedCount: planned.filter(f => f.producerStatus === 'generated').length, eligibleCount: eligible.length, excludedCount: rows.filter(r => !r.eligible).length, sourceRankedCount: scored.length, missingSourceCount: missing.length },
        interfaceSupport: { status: interfaceState, validCandidateCount: valid.length, noContactCount: valid.filter(f => f.interface.status === 'no-contact').length, contactingCount: valid.filter(f => f.interface.status === 'contacting').length,
          unavailableCount: valid.filter(f => f.interface.status === 'unavailable').length, selected: selected.map(id => ({ id, status: byId.get(id).interface.status })),
          interpretation: 'Contact presence is a coordinate observation, not correctness or affinity. No-contact candidates stay ranked; an all-no-contact set does not support a binding-interface selection.' } });
    }
  }
  return { arms, ranks, blocks };
}
