import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KNOWN_INPUTS, parseExternalMetadata } from './capture-global-text-discovery.mjs';
import { canonical, parseGraphqlResponse } from '../hard-decoy/v3-entry-metadata.mjs';
import { parseStrictJson } from '../hard-decoy/oracle/canonical-json.mjs';
import { screenEntries } from './screen-gpcrdb-complement.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..');
const BASE = 'validation/hard-decoy-holdout-v3/';
const SCRIPT = 'scripts/hard-decoy-v3/capture-phrase-only-chunk.mjs';
const ENDPOINT = 'https://data.rcsb.org/graphql';
const ROUTE = 'C6_RETAINED_PHRASE_ONLY_OPERATIONAL_CHUNK';
const MAX = 16 * 1024 * 1024;
const PINNED = { ...KNOWN_INPUTS, ...{
  "validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04/phrase-only-pending-identifiers.txt": "0860b4bc5539ad90eed5868e7c173b0f541ae54e4b71b9e2e4f07ba431ec8b75",
  "validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04/entries.jsonl": "fde2a0de338d34ea0e2baf56924b20bbc2de113b821a30af9c976b064d3a92d0",
  "validation/hard-decoy-holdout-v3/m1-nb1b4-source-review-2026-09-04/sequence-evidence/metadata-entry.json": "8ad175b2902b7ef0407953cf4ab99bf25f5da110706b5c070ac7a4fe24ef8ae6",
  "validation/hard-decoy-holdout-v3/development-metadata-snapshot-2026-08-29/entities.jsonl": "8e2219f94d91bb3a8822e56a1e43f20cc652a86bc9458a9af76013f96e3c5be7",
  "validation/hard-decoy-holdout-v3/entry-metadata-draft/entry-metadata-contract.json": "bbf10ef8ebf057dde42969fbd166bcbd2bd437902a76064d7ad8fcea9faa16b7",
  "validation/hard-decoy-holdout-v3/entry-metadata-draft/rcsb-entry-metadata.graphql": "9dd4489ebd50216f506fd9147778d89e4a250abc2c688d459af817efa6e2fde0",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/candidate-vhh-profiles.jsonl": "58d435ce89bd45c997aa89f0816340c273d24f5474e2d38c2bd2c85fce3cc39d",
  "validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl": "1c791d337d628a1de397eb33cfe5685d76953e169bfbf1077798365fa9fa8730",
  "scripts/hard-decoy-v3/capture-global-text-discovery.mjs": "f130e02a21fb8a91f6785bf20ccd3a8cfbec5e72ea5d6274c3228ad18369b491",
  "scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs": "c672c8153efde95470fc140d57d47b1d177e37f466e3dc5f7f8e22554fdb9eb2",
  "scripts/hard-decoy/v3-entry-metadata.mjs": "77afbf8b485976fd902de4f8377dcf9f02e90d93328a1da06546c8d7aae7c562",
  "scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs": "5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb",
  "scripts/hard-decoy/oracle/canonical-json.mjs": "6d60625e181d68671d98ec59258660f27799c83261ddaa197ae0a2e449730f5f",
  "node_modules/immunum/immunum.js": "a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00",
  "node_modules/immunum/immunum_bg.wasm": "68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b"
} };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = object => `${canonical(object)}\n`;
const lines = rows => rows.map(json).join('');
const idsText = ids => ids.length ? `${ids.join('\n')}\n` : '';
const sorted = values => [...new Set(values)].sort();
const parse = bytes => parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maximumCharacters: MAX * 4, maximumTokens: 5000000, maximumDepth: 64 });
const rows = bytes => { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); assert.ok(text.endsWith('\n'), 'Missing JSONL terminator'); return text.trimEnd().split('\n').map(line => parse(Buffer.from(line))); };
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const AUTHORITY = { broaderDiscoveryComplete: false, wholeCensusComponentUpperBound: null, targetFreezePermitted: false,
  formalDispositionAssigned: false, formalLeakageGraphAuthority: false, formalNoEdgeAuthority: false,
  independentEligibleGroupsAdded: 0, predictiveAccuracyMeasured: false, nativeCoordinatesAccessed: false,
  nativeRelativePosesAccessed: false, contactTablesAccessed: false, labelsAccessed: false, predictionOutputsAccessed: false,
  primaryArticleBodiesAccessed: false };
async function direct(root, relative, digest) {
  assert.ok(!path.isAbsolute(relative) && relative.split('/').every(part => part && !['.', '..'].includes(part)), 'Unsafe relative path');
  const file = path.join(root, relative); assert.equal(await realpath(file), file, 'Symlink file forbidden');
  const info = await lstat(file, { bigint: true }); assert.ok(info.isFile() && info.nlink === 1n && info.size <= BigInt(MAX * 4), 'Expected bounded regular file');
  const bytes = await readFile(file); assert.equal(BigInt(bytes.length), info.size, 'File changed while reading');
  if (digest) assert.equal(sha(bytes), digest, `Pinned input changed: ${relative}`); return bytes;
}
async function immutable(root, relative, bytes) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  if (await exists(path.join(root, relative))) assert.ok((await direct(root, relative)).equals(Buffer.from(bytes)), `Immutable file drift: ${relative}`);
  else await writeFile(path.join(root, relative), bytes, { flag: 'wx' });
}
async function inventory(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Symlink directory entry forbidden'); const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await inventory(root, rel)); else { assert.ok(entry.isFile()); result.push(rel); }
  }
  assert.ok(result.length <= 10000, 'Packet inventory bound exceeded'); return result.sort();
}

/** The saved membership and lexical ordinal define operations, never biological eligibility. */
export function selectPhraseChunk(pendingIds, metadataSources, chunkIndex = 0) {
  assert.deepEqual(pendingIds, sorted(pendingIds), 'Pending membership must be sorted and unique');
  assert.ok(pendingIds.every(id => /^[0-9][A-Z0-9]{3}$/u.test(id)), 'Invalid pending identifier');
  assert.ok(Number.isSafeInteger(chunkIndex) && chunkIndex >= 0, 'Invalid chunk index');
  assert.equal(new Set(metadataSources.map(row => row.source)).size, metadataSources.length, 'Duplicate metadata source');
  const complete = new Map(), partial = new Set();
  for (const { source, entries } of metadataSources) {
    assert.equal(new Set(entries.map(row => row.pdbId)).size, entries.length, 'Duplicate metadata source entry');
    for (const entry of entries) {
      assert.match(entry.pdbId, /^[0-9][A-Z0-9]{3}$/u, 'Invalid metadata identifier');
      const full = Array.isArray(entry.polymerEntities) && entry.polymerEntityCountReported === entry.polymerEntities.length
        && entry.metadataCompleteness?.polymerEntityCountMatches === true
        && new Set(entry.polymerEntities.map(row => row.entityId)).size === entry.polymerEntities.length;
      if (!full) { partial.add(entry.pdbId); continue; }
      if (!complete.has(entry.pdbId)) complete.set(entry.pdbId, []);
      complete.get(entry.pdbId).push({ source, rowId: entry.pdbId, canonicalEntrySha256: sha(canonical(entry)) });
    }
  }
  const exclusions = pendingIds.filter(id => complete.has(id)).map(pdbId => ({ pdbId, reason: 'ALREADY_RETAINED_COMPLETE_POLYMER_INVENTORY_METADATA', sources: complete.get(pdbId) }));
  const operational = pendingIds.filter(id => !complete.has(id));
  const selected = operational.slice(chunkIndex * 250, (chunkIndex + 1) * 250);
  assert.ok(selected.length, 'Chunk outside saved operational remainder');
  return { originalPendingCount: pendingIds.length, completeKnownMetadataIdCount: complete.size,
    alreadyRetainedExclusionCount: exclusions.length, operationalRemainderCount: operational.length,
    incompleteExistingMetadataIdsNotExcluded: sorted(partial), exclusions, selected,
    chunkIndex, chunkSize: 250, chunkCount: Math.ceil(operational.length / 250),
    selectedOrdinalStartInclusive: chunkIndex * 250, selectedOrdinalEndExclusive: chunkIndex * 250 + selected.length,
    operationalIdentifierStreamSha256: sha(idsText(operational)), selectedIdentifierStreamSha256: sha(idsText(selected)) };
}
export async function phraseChunkContext(repositoryRoot = ROOT, chunkIndex = 0) {
  const root = path.resolve(repositoryRoot); assert.equal(await realpath(root), root, 'Symlink repository root forbidden');
  const data = new Map(), inputDigests = {};
  for (const [relative, digest] of Object.entries(PINNED)) { const bytes = await direct(root, relative, digest); data.set(relative, bytes); inputDigests[relative] = { sha256: digest, bytes: bytes.length }; }
  for (const relative of [SCRIPT, 'package-lock.json', 'node_modules/immunum/package.json']) { const bytes = await direct(root, relative); inputDigests[relative] = { sha256: sha(bytes), bytes: bytes.length }; }
  const pending = String(data.get(`${BASE}global-text-discovery-2026-09-04/phrase-only-pending-identifiers.txt`)); assert.ok(pending.endsWith('\n'));
  const pendingIds = pending.trimEnd().split('\n'); assert.equal(pendingIds.length, 12262, 'Original remainder changed');
  const metadataSources = Object.keys(PINNED).filter(name => name.endsWith('/entries.jsonl')).map(source => ({ source, entries: rows(data.get(source)) }));
  const m1 = `${BASE}m1-nb1b4-source-review-2026-09-04/sequence-evidence/metadata-entry.json`;
  metadataSources.push({ source: m1, entries: [parse(data.get(m1))] });
  const selected = selectPhraseChunk(pendingIds, metadataSources, chunkIndex);
  const sparseDevelopment = rows(data.get(`${BASE}development-metadata-snapshot-2026-08-29/entities.jsonl`));
  const contract = parse(data.get(`${BASE}entry-metadata-draft/entry-metadata-contract.json`));
  const query = String(data.get(contract.rcsb.queryFile));
  assert.equal(contract.rcsb.endpoint, ENDPOINT); assert.equal(contract.rcsb.method, 'POST'); assert.equal(contract.rcsb.batchSize, 25); assert.equal(contract.rcsb.repeatCount, 2); assert.equal(sha(query), contract.rcsb.querySha256);
  const requests = [];
  for (let offset = 0; offset < selected.selected.length; offset += 25) for (const repeat of [1, 2]) {
    const batchIndex = offset / 25 + 1, ids = selected.selected.slice(offset, offset + 25), stem = `batch-${String(batchIndex).padStart(3, '0')}-repeat-${repeat}`;
    const body = `${JSON.stringify({ query, variables: { ids } })}\n`;
    requests.push({ stem, batchIndex, repeat, ids, endpoint: ENDPOINT, method: 'POST', requestFile: `requests/${stem}.json`, requestBodySha256: sha(body), body });
  }
  const referenceRows = [['HISTORICAL_KEYWORD_PROFILE_ROLE_UNRESOLVED', 'candidate'], ['DEVELOPMENT_PROFILE', 'development']].map(([category, kind]) => ({ category, rows: rows(data.get(`${BASE}vhh-sequence-pregraph-2026-08-29/${kind}-vhh-profiles.jsonl`)) }));
  const plan = { schemaVersion: '1.0.0', studyId: 'confovhh-hard-decoy-holdout-v3', route: ROUTE,
    selectionPolicy: 'FIXED_LEXICAL_250_ID_OPERATIONAL_CHUNK_OF_SAVED_PHRASE_ONLY_MEMBERSHIP_MINUS_EXACT_BOUND_COMPLETE_METADATA_INVENTORIES',
    biologicalSelectionPolicy: false, scientificPreregistrationClaimed: false,
    ...selected, inputDigests, metadataInventorySources: metadataSources.map(row => ({ source: row.source, entryCount: row.entries.length })),
    sparseDevelopmentIdsAreExclusions: false, sparseDevelopmentIdsInSelectedChunk: sorted(sparseDevelopment.filter(row => selected.selected.includes(row.pdbId)).map(row => row.pdbId)),
    requestCount: requests.length, repeatCount: 2, batchSize: 25,
    requestSpecifications: requests.map(({ body: _body, ...request }) => request), ...AUTHORITY };
  return { root, plan, requests, contract, referenceRows };
}
export function normalizePhraseResponse(bytes, request, contract) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(bytes.length <= MAX, 'Oversized metadata response');
  const external = parseExternalMetadata(text), envelope = external.normalized;
  assert.ok(Array.isArray(envelope?.data?.entries), 'Missing GraphQL entries');
  const present = envelope.data.entries.filter(row => row !== null), returned = present.map(row => row.rcsb_id);
  assert.equal(new Set(returned).size, returned.length, 'Duplicate returned entry'); assert.ok(returned.every(id => request.ids.includes(id)), 'Response outside requested membership');
  const missingIds = request.ids.filter(id => !returned.includes(id));
  const sourceMap = new Map(request.ids.map(pdbId => [pdbId, { pdbId, rcsbQueryIds: [ROUTE] }]));
  const gpcrdbMap = new Map(request.ids.map(pdbId => [pdbId, {}]));
  const entries = parseGraphqlResponse(JSON.stringify({ ...envelope, data: { ...envelope.data, entries: present } }), { batchIndex: request.batchIndex, ids: request.ids.filter(id => returned.includes(id)) }, sourceMap, gpcrdbMap, contract);
  return { entries, missingIds, titleWhitespaceAdjustments: external.adjustments };
}
async function prepared(ctx, directory, online) {
  const items = new Map([['collection-plan.json', json(ctx.plan)], ['identifiers.txt', idsText(ctx.plan.selected)]]);
  for (const request of ctx.requests) items.set(request.requestFile, request.body);
  for (const [name, bytes] of items) if (online) await immutable(directory, name, bytes); else assert.ok((await direct(directory, name)).equals(Buffer.from(bytes)), `Prepared input drift: ${name}`);
}
function captureRequestFields(request) { const { body: _body, ...result } = request; return result; }
async function readAttempts(ctx, directory) {
  const names = await inventory(directory), preparedNames = new Set(['collection-plan.json', 'identifiers.txt', ...ctx.requests.map(row => row.requestFile)]);
  const captures = [], snapshotIds = new Set();
  // Validate every name before reading capture or raw payloads.
  for (const name of names) {
    if (preparedNames.has(name)) continue;
    if (/^snapshots\/[a-f0-9]{64}\/[A-Za-z-]+\.(?:json|jsonl|md|sha256)$/u.test(name)) { snapshotIds.add(name.split('/')[1]); continue; }
    const match = /^(captures|raw)\/(batch-\d{3}-repeat-[12])-attempt-([1-9]\d*)\.json$/u.exec(name);
    assert.ok(match && ctx.requests.some(row => row.stem === match[2]), `File outside planned inventory: ${name}`);
  }
  for (const request of ctx.requests) {
    const captureNames = names.filter(name => name.startsWith(`captures/${request.stem}-attempt-`));
    assert.ok(captureNames.length <= 100, 'Attempt bound exceeded');
    const ordinals = captureNames.map(name => Number(/-attempt-(\d+)\.json$/u.exec(name)[1])).sort((a, b) => a - b);
    assert.deepEqual(ordinals, Array.from({ length: ordinals.length }, (_, i) => i + 1), 'Capture attempt gap');
    let successful = 0;
    for (const ordinal of ordinals) {
      const stem = `${request.stem}-attempt-${ordinal}`, captureFile = `captures/${stem}.json`, rawFile = `raw/${stem}.json`;
      assert.ok(names.includes(rawFile), 'Capture missing raw response');
      const record = parse(await direct(directory, captureFile));
      for (const [key, value] of Object.entries(captureRequestFields(request))) assert.equal(canonical(record[key]), canonical(value), `Capture request binding drift: ${key}`);
      assert.equal(record.attempt, ordinal); assert.equal(record.rawFile, rawFile); assert.equal(record.captureFile, captureFile);
      assert.equal(record.finalUrl, ENDPOINT); assert.equal(record.redirected, false);
      assert.ok(Number.isFinite(Date.parse(record.startedAt)) && Date.parse(record.completedAt) >= Date.parse(record.startedAt));
      const bytes = await direct(directory, rawFile, record.responseSha256); assert.equal(bytes.length, record.responseBytes);
      let result = null;
      if (record.outcome === 'SUCCESS') {
        assert.equal(record.status, 200); assert.equal(record.error, null); assert.ok(['application/json', 'application/graphql-response+json'].includes(String(record.contentType).split(';')[0].trim().toLowerCase()));
        result = normalizePhraseResponse(bytes, request, ctx.contract); assert.equal(sha(json(result)), record.normalizedSha256); successful += 1;
      } else { assert.equal(record.outcome, 'FAILURE'); assert.equal(typeof record.error, 'string'); assert.match(record.errorOriginalUtf8Sha256, /^[a-f0-9]{64}$/u); assert.equal(record.normalizedSha256, null); }
      assert.ok(successful <= 1, 'Multiple successful captures for request');
      captures.push({ record, result, recordSha256: sha(await direct(directory, captureFile)) });
    }
    assert.equal(names.filter(name => name.startsWith(`raw/${request.stem}-attempt-`)).length, captureNames.length, 'Orphan raw response');
  }
  return { captures, snapshotIds: [...snapshotIds].sort() };
}
async function boundedResponse(response) {
  const chunks = []; let size = 0;
  assert.ok(response.body, 'Missing response body');
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= MAX, 'Response exceeds cap'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function capture(ctx, directory, request, ordinal, options) {
  const record = { ...captureRequestFields(request), attempt: ordinal,
    rawFile: `raw/${request.stem}-attempt-${ordinal}.json`, captureFile: `captures/${request.stem}-attempt-${ordinal}.json`,
    startedAt: options.now(), completedAt: null, finalUrl: ENDPOINT, redirected: false, status: null, contentType: null,
    responseSha256: null, responseBytes: 0, normalizedSha256: null, outcome: 'FAILURE', error: null, errorOriginalUtf8Sha256: null };
  let bytes = Buffer.alloc(0), result = null;
  try {
    assert.equal(request.endpoint, ENDPOINT); assert.equal(request.method, 'POST');
    assert.equal(sha(await direct(directory, request.requestFile)), request.requestBodySha256);
    const response = await options.fetchImpl(ENDPOINT, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': ctx.contract.rcsb.userAgent }, body: request.body, redirect: 'error', signal: AbortSignal.timeout(ctx.contract.rcsb.timeoutMilliseconds) });
    record.finalUrl = response.url || ENDPOINT; record.redirected = response.redirected; record.status = response.status; record.contentType = response.headers.get('content-type');
    assert.equal(record.finalUrl, ENDPOINT, 'Unexpected response endpoint'); assert.equal(record.redirected, false, 'Redirect forbidden');
    bytes = await boundedResponse(response); assert.equal(record.status, 200, `HTTP ${record.status}`);
    assert.ok(['application/json', 'application/graphql-response+json'].includes(String(record.contentType).split(';')[0].trim().toLowerCase()), 'Unexpected content type');
    result = normalizePhraseResponse(bytes, request, ctx.contract); record.normalizedSha256 = sha(json(result)); record.outcome = 'SUCCESS';
  } catch (error) { const message = String(error.message); record.errorOriginalUtf8Sha256 = sha(message); record.error = message.replace(/[\u0000-\u001f]/gu, ' '); }
  record.completedAt = options.now(); record.responseSha256 = sha(bytes); record.responseBytes = bytes.length;
  await immutable(directory, record.rawFile, bytes); await immutable(directory, record.captureFile, json(record));
  return { record, result, recordSha256: sha(json(record)) };
}
function snapshotFiles(ctx, captures) {
  const entries = [], accounting = [], adjustments = [];
  for (let i = 0; i < ctx.requests.length; i += 2) {
    const pair = ctx.requests.slice(i, i + 2), successful = pair.map(request => captures.find(row => row.record.stem === request.stem && row.record.outcome === 'SUCCESS'));
    const equal = successful.every(Boolean) && canonical(successful[0].result) === canonical(successful[1].result);
    for (const pdbId of pair[0].ids) {
      const entry = equal ? successful[0].result.entries.find(row => row.pdbId === pdbId) : null;
      const status = !successful.every(Boolean) ? 'PENDING_SUCCESSFUL_REPEATED_CAPTURE' : !equal ? 'UNRESOLVED_REPEAT_DISAGREEMENT' : entry ? 'CAPTURED_REPEATED_METADATA' : 'MISSING_FROM_BOTH_RESPONSES_NOT_ABSENCE_PROOF';
      accounting.push({ pdbId, batchIndex: pair[0].batchIndex, status, repeatAgreement: Boolean(equal), requests: pair.map(row => row.stem), absenceEstablished: false });
      if (entry) entries.push(entry);
    }
    for (const row of successful.filter(Boolean)) adjustments.push(...row.result.titleWhitespaceAdjustments.map(item => ({ ...item, requestStem: row.record.stem })));
  }
  const screen = screenEntries(entries, ctx.referenceRows);
  assert.equal(accounting.length, ctx.plan.selected.length); assert.equal(new Set(accounting.map(row => row.pdbId)).size, accounting.length);
  const complete = accounting.every(row => ['CAPTURED_REPEATED_METADATA', 'MISSING_FROM_BOTH_RESPONSES_NOT_ABSENCE_PROOF'].includes(row.status));
  const captureBindings = captures.map(row => ({ captureFile: row.record.captureFile, sha256: row.recordSha256 })).sort((a, b) => a.captureFile.localeCompare(b.captureFile));
  const stateSha256 = sha(json(captureBindings));
  const summary = { schemaVersion: '1.0.0', status: complete ? entries.length === accounting.length ? 'CHUNK_REPEATED_METADATA_COMPLETE' : 'CHUNK_REQUESTS_COMPLETE_WITH_MISSING_METADATA' : 'CHUNK_INCOMPLETE_RETAINED_FOR_RESUME',
    chunkIndex: ctx.plan.chunkIndex, originalPhraseOnlyPendingCount: ctx.plan.originalPendingCount, alreadyRetainedExclusionCount: ctx.plan.alreadyRetainedExclusionCount,
    operationalRemainderCount: ctx.plan.operationalRemainderCount, intendedIdentifierCount: accounting.length, capturedEntryCount: entries.length,
    missingMetadataCount: accounting.filter(row => row.status === 'MISSING_FROM_BOTH_RESPONSES_NOT_ABSENCE_PROOF').length,
    repeatDisagreementIdentifierCount: accounting.filter(row => row.status === 'UNRESOLVED_REPEAT_DISAGREEMENT').length,
    pendingCaptureIdentifierCount: accounting.filter(row => row.status === 'PENDING_SUCCESSFUL_REPEATED_CAPTURE').length,
    savedSuccessfulResponseCount: captures.filter(row => row.record.outcome === 'SUCCESS').length, retainedFailedAttemptCount: captures.filter(row => row.record.outcome === 'FAILURE').length,
    uncollectedWithinPinnedOperationalRemainderAfterThisChunk: ctx.plan.operationalRemainderCount - entries.length,
    screenSummary: screen.summary, captureStateSha256: stateSha256, ...AUTHORITY };
  const files = new Map([['summary.json', json(summary)], ['capture-bindings.json', json(captureBindings)], ['identifier-accounting.jsonl', lines(accounting)],
    ['entries.jsonl', lines(entries)], ['entity-screens.jsonl', lines(screen.entityScreens)], ['sequence-screens.jsonl', lines(screen.sequenceScreens)],
    ['review-queue.jsonl', lines(screen.reviewQueue)], ['citation-title-adjustments.jsonl', lines(adjustments)]]);
  files.set('README.md', `# Phrase-only discovery operational chunk ${ctx.plan.chunkIndex}\n\nThis fixed lexical chunk covers ${accounting.length} saved identifiers from a pinned operational remainder of ${ctx.plan.operationalRemainderCount}, preserving the original ${ctx.plan.originalPendingCount}-identifier phrase-only denominator. It is an operational partition, not a biological selection or earlier scientific preregistration. Existing exclusions require exact bound complete polymer inventories; sparse development metadata is not an exclusion.\n\nOnly the unchanged metadata GraphQL query is requested, in 25-entry batches repeated twice. Successful normalized responses must agree before any entry enters the derived inventory or sequence screen. Missing responses, repeat disagreements and absent entries stay in the denominator. Failure diagnostic control whitespace is serialized as spaces with the original diagnostic UTF-8 digest retained; raw response bytes are unchanged. Failed attempts and request/response bytes remain immutable; collect resumes only requests without a saved successful response.\n\nThe unchanged all-polymer IMGT sequence screen yields review signals, not VHH identity, receptor assignment, binding-role proof, eligibility, absence or independent components. Every intended identifier and every returned polymer are accounted. The remaining phrase-only and broader discovery routes remain incomplete. No coordinates, relative poses, contact tables, labels, predictions or article bodies are requested.\n\nThis immutable state snapshot is identified by all capture-record hashes. Verify the enclosing packet with \`node scripts/hard-decoy-v3/capture-phrase-only-chunk.mjs verify --output-directory PACKET --chunk-index ${ctx.plan.chunkIndex}\`. Restore global text metadata first with the existing restoration command.\n`);
  files.set('manifest.json', json({ schemaVersion: '1.0.0', planSha256: sha(json(ctx.plan)), captureStateSha256: stateSha256, captureBindings,
    files: [...files].map(([name, value]) => ({ name, sha256: sha(value), bytes: Buffer.byteLength(value) })), ...AUTHORITY }));
  files.set('checksums.sha256', [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${sha(value)}  ${name}\n`).join(''));
  return { stateSha256, summary, files };
}
async function verifySnapshots(ctx, directory, state) {
  const allowed = new Set(snapshotFiles(ctx, []).files.keys());
  for (const id of state.snapshotIds) {
    const relative = `snapshots/${id}`, actual = await readdir(path.join(directory, relative)); assert.deepEqual(actual.sort(), [...allowed].sort(), 'Snapshot inventory changed');
    const bindings = parse(await direct(directory, `${relative}/capture-bindings.json`));
    assert.equal(sha(json(bindings)), id, 'Snapshot ID differs from capture binding');
    const included = bindings.map(binding => { const found = state.captures.find(row => row.record.captureFile === binding.captureFile); assert.ok(found && found.recordSha256 === binding.sha256, 'Snapshot capture outside validated inventory'); return found; });
    assert.equal(new Set(bindings.map(row => row.captureFile)).size, bindings.length, 'Duplicate snapshot capture');
    const expected = snapshotFiles(ctx, included);
    for (const [name, bytes] of expected.files) assert.ok((await direct(directory, `${relative}/${name}`)).equals(Buffer.from(bytes)), `Snapshot replay mismatch: ${name}`);
  }
}
export async function runPhraseOnlyChunk(mode, { repositoryRoot = ROOT, outputDirectory, chunkIndex = 0, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), delay = ms => new Promise(resolve => setTimeout(resolve, ms)), onProgress = () => {} } = {}) {
  assert.ok(['collect', 'verify'].includes(mode), 'Expected collect or verify');
  const ctx = await phraseChunkContext(repositoryRoot, chunkIndex), online = mode === 'collect';
  const directory = path.resolve(outputDirectory ?? path.join(ctx.root, BASE, `phrase-only-chunk-${String(chunkIndex).padStart(3, '0')}-2026-09-08`));
  assert.ok(![ctx.root, path.join(ctx.root, BASE)].includes(directory) && !/\/(?:source|entry-metadata)-snapshot-/u.test(directory), 'Frozen or root output forbidden');
  if (online) await mkdir(directory, { recursive: true }); assert.equal(await realpath(directory), directory, 'Symlink output forbidden');
  if (online) { const names = await readdir(directory); assert.ok(names.length === 0 || names.includes('collection-plan.json'), 'Unrelated output directory'); }
  await prepared(ctx, directory, online);
  let state = await readAttempts(ctx, directory); await verifySnapshots(ctx, directory, state);
  if (online) {
    for (const request of ctx.requests) {
      if (state.captures.some(row => row.record.stem === request.stem && row.record.outcome === 'SUCCESS')) continue;
      let outcome;
      for (let retry = 0; retry < 3; retry++) {
        const ordinal = state.captures.filter(row => row.record.stem === request.stem).length + 1;
        assert.ok(ordinal <= 100, 'Request attempt bound exceeded'); outcome = await capture(ctx, directory, request, ordinal, { fetchImpl, now }); state.captures.push(outcome);
        onProgress({ request: request.stem, attempt: ordinal, outcome: outcome.record.outcome, status: outcome.record.status, bytes: outcome.record.responseBytes, error: outcome.record.error });
        if (outcome.record.outcome === 'SUCCESS' || ![null, 429, 500, 502, 503, 504].includes(outcome.record.status)) break;
        if (retry < 2) await delay(retry === 0 ? 2000 : 5000);
      }
      if (outcome.record.outcome !== 'SUCCESS') break;
      await delay(ctx.contract.rcsb.minimumDelayMilliseconds);
    }
  }
  const result = snapshotFiles(ctx, state.captures), relative = `snapshots/${result.stateSha256}`;
  if (online) for (const [name, bytes] of result.files) await immutable(directory, `${relative}/${name}`, bytes);
  else assert.ok(state.snapshotIds.includes(result.stateSha256), 'Current capture state has no derived snapshot');
  return { ...result.summary, snapshotDirectory: relative };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), mode = args.shift(), options = {};
  while (args.length) { const flag = args.shift(), value = args.shift(); assert.ok(value && ['--repository-root', '--output-directory', '--chunk-index'].includes(flag), 'Invalid CLI arguments'); const key = { '--repository-root': 'repositoryRoot', '--output-directory': 'outputDirectory', '--chunk-index': 'chunkIndex' }[flag]; assert.ok(!(key in options), 'Duplicate CLI argument'); options[key] = key === 'chunkIndex' ? Number(value) : path.resolve(value); }
  console.log(JSON.stringify(await runPhraseOnlyChunk(mode, { ...options, onProgress: message => console.error(JSON.stringify(message)) }), null, 2));
}
