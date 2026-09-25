#!/usr/bin/env python3
"""Development-only calibration. Authentication is bound before label access.

The JS bridge invokes the actual selector. This module evaluates saved ranks;
it never reconstructs source blocks or eligibility from labels.
"""
from __future__ import annotations
import argparse
import datetime as dt
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
WORK = HERE.parents[1]
REPO = WORK/'ConfoVHH'
spec = importlib.util.spec_from_file_location('v3_pure_evaluation', REPO/'scripts/external-ranking-v3/evaluate.py')
evaluator = importlib.util.module_from_spec(spec); spec.loader.exec_module(evaluator)
GROUPS = {'dev_6knm':'APLNR-JN241', 'dev_8qot':'OPRM1-NbE', 'dev_8th3':'AGTR1-AT118', 'dev_8th4':'AGTR1-AT118'}
GRID = [0,.002,.005,.01,.02]
ARM = 'source-validity-cdr-calibrated'
COMMIT = 'b1ebfc46ecf57f5414e0d1a6f9027bbb122c53bc'
MODEL = '090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1'
PROTOCOL = '9cf1b2444c67dbaccbe3c8a8c826e980ac4877d790f955d6ab6b9233d03680b5'
DEFAULT_NODE = '/Users/darwin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'


def check(value, message):
    if not value:
        raise ValueError(message)


def exact(value, keys):
    check(type(value) is dict and set(value) == set(keys), 'Unexpected or absent fields')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return type(value) is str and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def finite(value):
    return type(value) in (float,int) and math.isfinite(value)


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key,value in pairs:
            check(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    def reject(value):
        raise ValueError('Nonfinite JSON constant: '+value)
    return json.loads(raw, object_pairs_hook=unique, parse_constant=reject)


def bound(root, binding):
    exact(binding, ['path','bytes','sha256'])
    check(type(binding['path']) is str and binding['path'] and '\\' not in binding['path'] and not Path(binding['path']).is_absolute() and '..' not in Path(binding['path']).parts, 'Unsafe binding path')
    check(type(binding['bytes']) is int and 0 < binding['bytes'] <= 32_000_000 and digest(binding['sha256']), 'Invalid binding')
    path = root/binding['path']
    check(path.resolve() == path and path.is_file() and not path.is_symlink(), 'Indirect/missing bound file')
    raw = path.read_bytes()
    check(len(raw) == binding['bytes'] and sha(raw) == binding['sha256'], 'Bound file identity differs')
    return raw


def save(path, value):
    raw = (json.dumps(value,indent=2,allow_nan=False)+'\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)
    return sha(raw)


def verify_inventory(rows):
    check(type(rows) is list and len(rows) == 100, 'Exactly 100 fresh development attempts required')
    check(len({r['id'] for r in rows}) == 100, 'Duplicate development attempt ID')
    for row in rows:
        check(row['setId'] in GROUPS and type(row['seed']) is int and 0 <= row['seed'] < 25, 'Prospective/outside-development target or invalid seed')
        check(type(row['id']) is str and row['id'].startswith(row['setId']+'_'), 'Attempt ID must identify its allowed development target')
    for set_id in GROUPS:
        check(sorted(r['seed'] for r in rows if r['setId'] == set_id) == list(range(25)), 'Development set lacks a planned seed or duplicates one')


def load_predictions(root, request, node=DEFAULT_NODE):
    exact(request, ['schema','calibrationId','startedAtUtc','executionFreeze','producerProvenance','cohorts','outcomeMap','analysisReceipt'])
    check(request['schema'] == 'confovhh-round3-gap-calibration-input-v1', 'Invalid calibration request')
    check(type(request['calibrationId']) is str and request['calibrationId'] and all(c.isalnum() or c in '_.:+-' for c in request['calibrationId']), 'Invalid calibration ID')
    when = dt.datetime.fromisoformat(request['startedAtUtc'].replace('Z','+00:00'))
    check(when.utcoffset() == dt.timedelta(0), 'Freeze timestamp must be UTC')
    freeze_raw = bound(root,request['executionFreeze']); freeze = strict_json(freeze_raw)
    check(freeze['files']['PROTOCOL.md'] == PROTOCOL, 'Execution freeze differs from frozen calibration protocol')
    provenance_raw = bound(root,request['producerProvenance']); provenance = strict_json(provenance_raw)
    exact(provenance,['schema','generatorId','producerVersion','scoreContext','scoreName','direction','packageVersion','sourceCommit','modelSha256','contextRegime','scientificSettings','generationRunId','executionFreezeSha256','attempts'])
    check(provenance['schema'] == 'confovhh-round3-pair-producer-provenance-v1' and provenance['packageVersion'] == '2.2.1' and provenance['sourceCommit'] == COMMIT and provenance['modelSha256'] == MODEL and provenance['contextRegime'] == 'pair', 'Only pinned fresh Boltz pair-context development provenance is accepted')
    check(provenance['executionFreezeSha256'] == sha(freeze_raw) and type(provenance['generationRunId']) is str and provenance['generationRunId'], 'Missing fresh execution provenance')
    settings = provenance['scientificSettings']
    expected = {'recyclingSteps':3,'samplingSteps':200,'diffusionSamples':1,'stepScale':1.5,'seeds':list(range(25)),'precision':'bf16-mixed','templates':False,'restraints':False,'forcePotentials':False}
    check(settings == expected and all(type(settings[k]) is type(v) for k,v in expected.items()) and all(type(v) is int for v in settings['seeds']), 'Producer scientific settings differ from the frozen regime')
    verify_inventory(provenance['attempts'])
    for row in provenance['attempts']:
        exact(row,['id','setId','seed','generationReceiptSha256','coordinateSha256'])
        check(digest(row['generationReceiptSha256']) and (row['coordinateSha256'] is None or digest(row['coordinateSha256'])), 'Missing generation/coordinate provenance')
    bundles, receipts, saved_ranks, seen_ids, seen_sets, contact_replays = [], [], [], set(), set(), []
    check(type(request['cohorts']) is list and 1 <= len(request['cohorts']) <= 4, 'Invalid development bundle count')
    for binding in request['cohorts']:
        raw = bound(root,binding); receipt = strict_json(raw); receipts.append(sha(raw))
        check(receipt['schema'] == 'confovhh-source-first-receipt-v3' and receipt['evaluationRole'] == 'development' and receipt['outcomeInputs'] == [], 'Only prediction-only development v3 receipts are accepted')
        check(set(receipt['files']) == {'manifest.json','source-score-receipt.json','source-manifest.json','source-features.json','source-attempts.json','source-ranks.json','features.json','attempts.json','ranks.json','blocks.json','calibrations.json','contact-evidence.json'}, 'Unexpected saved file kind, possible outcome leakage')
        folder = (root/binding['path']).parent
        for rel,expected_sha in receipt['files'].items():
            check(type(rel) is str and Path(rel).name == rel and digest(expected_sha), 'Unsafe/invalid v3 saved-file identity')
            path = folder/rel
            check(path.resolve() == path and path.is_file() and path.stat().st_size <= 32_000_000 and sha(path.read_bytes()) == expected_sha, 'Saved v3 file hash differs')
        for rel in ('scripts/external-ranking-v3/policy.mjs','scripts/external-ranking-v3/score.mjs','scripts/external-ranking-v3/contact-only.mjs'):
            check(receipt['implementation'][rel] == sha((REPO/rel).read_bytes()), 'Saved v3 implementation differs from current selector')
        # Uses actual JS serialization/digest rules and recomputes all standalone
        # contact evidence from prediction coordinates before opening any labels.
        env={k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH')}
        replay=subprocess.run([node,str(REPO/'scripts/external-ranking-v3/verify-contact-evidence.mjs'),'--artifacts',str(root),'--receipt',str(root/binding['path'])],text=True,capture_output=True,env=env)
        check(replay.returncode==0,'Saved contact evidence replay failed: '+replay.stderr.strip())
        contact_replays.append(strict_json(replay.stdout))
        data = {name:strict_json((folder/name).read_bytes()) for name in ('manifest.json','source-manifest.json','features.json','ranks.json','calibrations.json')}
        saved_ranks.append(data['ranks.json'])
        input_ = data['manifest.json']; manifest = data['source-manifest.json']
        check(input_['evaluationRole'] == 'development' and len(input_['producerProfiles']) == 1 and len(manifest['generators']) == 1 and data['calibrations.json'] == {}, 'Only uncalibrated single-producer development bundles accepted')
        p, g = input_['producerProfiles'][0], manifest['generators'][0]
        check(p['calibration'] is None and p['version'] != 'unknown' and p['scoreProvenance'] == request['producerProvenance'], 'Producer profile must bind the supplied fresh provenance')
        check((p['generatorId'],p['version'],p['scoreContext'],g['id'],g['scoreName'],g['direction']) == (provenance['generatorId'],provenance['producerVersion'],provenance['scoreContext'],provenance['generatorId'],provenance['scoreName'],provenance['direction']), 'Producer profile identity/context differs')
        for policy in input_['setPolicies']:
            set_id = policy['setId']
            check(set_id in GROUPS and policy['biologicalGroupId'] == GROUPS[set_id] and set_id not in seen_sets, 'Outside development enrollment or lineage leakage')
            seen_sets.add(set_id)
        for attempt in manifest['attempts']:
            check(attempt['id'] not in seen_ids, 'Duplicate attempt across saved bundles'); seen_ids.add(attempt['id'])
        bundles.append({'input':input_,'sourceManifest':manifest,'features':data['features.json'],'calibrations':{}})
    check(seen_sets == set(GROUPS) and seen_ids == {r['id'] for r in provenance['attempts']}, 'Fresh provenance and v3 inventory differ')
    by_id = {r['id']:r for r in provenance['attempts']}
    for bundle in bundles:
        for attempt in bundle['sourceManifest']['attempts']:
            row = by_id[attempt['id']]
            check(row['setId'] == attempt['setId'] and row['coordinateSha256'] == (attempt['coordinate']['sha256'] if attempt['coordinate'] else None), 'Fresh provenance coordinate/target identity differs')
    return bundles, provenance, receipts, saved_ranks, {'producerProvenanceSha256':sha(provenance_raw),'executionFreezeSha256':sha(freeze_raw),'predictionContactReplays':contact_replays}


def authenticate_outcomes(root, request, provenance, receipts):
    raw = bound(root,request['outcomeMap']); outcomes = strict_json(raw)
    receipt_raw = bound(root,request['analysisReceipt']); authentication = strict_json(receipt_raw)
    exact(authentication,['schema','outcomeMapSha256','rankingReceiptSha256','producerProvenanceSha256','generationRunId','coordinateIdentityVerified','referenceIdentityVerified','outcomeArtifactsVerified','rankingSealedBeforeOutcomes','rows'])
    check(authentication['schema'] == 'confovhh-round3-development-outcome-authentication-v1' and authentication['outcomeMapSha256'] == sha(raw) and authentication['producerProvenanceSha256'] == request['producerProvenance']['sha256'] and authentication['generationRunId'] == provenance['generationRunId'], 'Outcome authentication binding differs')
    check(sorted(authentication['rankingReceiptSha256']) == sorted(receipts), 'Outcomes belong to different saved rankings')
    check(all(authentication[key] is True for key in ('coordinateIdentityVerified','referenceIdentityVerified','outcomeArtifactsVerified','rankingSealedBeforeOutcomes')), 'Outcome authentication attestation incomplete')
    exact(outcomes,['schema','evaluationRole','rows'])
    check(outcomes['schema'] == 'confovhh-round3-development-outcome-map-v1' and outcomes['evaluationRole'] == 'development', 'Only development outcome maps allowed')
    verify_inventory(outcomes['rows']); verify_inventory(authentication['rows'])
    produced = {r['id']:r for r in provenance['attempts']}; auth = {r['id']:r for r in authentication['rows']}
    check(set(produced) == set(auth) == {r['id'] for r in outcomes['rows']}, 'Outcome/authentication ID membership differs')
    for row in outcomes['rows']:
        exact(row,['id','setId','seed','coordinateSha256','status','DockQ','reason'])
        a = auth[row['id']]; exact(a,['id','setId','seed','coordinateSha256','referenceSha256','outcomeArtifactSha256'])
        for key in ('id','setId','seed','coordinateSha256'):
            check(row[key] == a[key] == produced[row['id']][key], 'Outcome/generation coordinate or seed identity differs')
        check(row['status'] in ('evaluated','unavailable') and type(row['reason']) is str, 'Invalid outcome disposition')
        if row['status'] == 'evaluated':
            check(finite(row['DockQ']) and 0 <= row['DockQ'] <= 1 and row['reason'] == '' and digest(a['referenceSha256']) and digest(a['outcomeArtifactSha256']) and digest(row['coordinateSha256']), 'Invalid authenticated outcome')
        else:
            check(row['DockQ'] is None and row['reason'] and (a['referenceSha256'] is None or digest(a['referenceSha256'])) and (a['outcomeArtifactSha256'] is None or digest(a['outcomeArtifactSha256'])), 'Invalid unavailable outcome state')
    return outcomes, {'outcomeMapSha256':sha(raw),'analysisReceiptSha256':sha(receipt_raw)}


def exact_first(record, values):
    selected = record['selected']
    return {'q':sum((Fraction(str(values[id_])) for id_ in selected),Fraction())/len(selected),
            'success':Fraction(sum(values[id_] >= .23 for id_ in selected),len(selected))}


def macro(values, sets):
    groups = sorted({GROUPS[s] for s in sets})
    return sum((sum((values[s] for s in sets if GROUPS[s] == g),Fraction())/sum(GROUPS[s] == g for s in sets) for g in groups),Fraction())/len(groups)


def number(value):
    return {'value':float(value),'exact':str(value)}


def analyze_grid(grid, outcome_map, enrollment):
    """Evaluate the complete frozen grid. No source feature or label fitting IO."""
    verify_inventory(enrollment); verify_inventory(outcome_map['rows'])
    check(outcome_map['schema'] == 'confovhh-round3-development-outcome-map-v1' and outcome_map['evaluationRole'] == 'development', 'Outside development outcome map')
    check(grid['grid'] == GRID and all(finite(g) for g in grid['grid']) and [r['gap'] for r in grid['rows']] == GRID and all(finite(r['gap']) for r in grid['rows']) and grid['outcomeInputs'] == [], 'Candidate gap grid differs')
    ids_by_set = {s:sorted(r['id'] for r in enrollment if r['setId'] == s) for s in GROUPS}
    check({r['id'] for r in outcome_map['rows']} == {r['id'] for r in enrollment}, 'Outcome IDs differ')
    values = {r['id']:r['DockQ'] for r in outcome_map['rows']}
    check(all(v is None or finite(v) and 0 <= v <= 1 for v in values.values()), 'Invalid numeric outcome')
    evaluated, exact_metrics, baselines = [], {}, None
    for candidate in grid['rows']:
        records = {(r['setId'],r['arm']):r for r in candidate['ranks']}
        check(len(records) == len(candidate['ranks']) and {s for s,a in records} == set(GROUPS), 'Grid set/arm membership differs')
        current, base = {}, {}
        for set_id in sorted(GROUPS):
            check((set_id,'source-only') in records and (set_id,ARM) in records, 'Required policy arm missing')
            pairs = {}
            for arm in ('source-only',ARM):
                record = records[set_id,arm]
                result = evaluator.evaluate_record(record,values,ids_by_set[set_id])
                evaluated.append({'gap':candidate['gap'],**result})
                pairs[arm] = exact_first(record,values) if result['firstChoiceDockQ'] is not None else None
            base[set_id] = pairs['source-only']; current[set_id] = pairs[ARM]
        check(baselines is None or baselines == base, 'Source baseline changes with candidate gap')
        baselines = base; exact_metrics[candidate['gap']] = current
    missing = sorted(id_ for id_,v in values.items() if v is None)
    unavailable = [{'gap':gap,'setId':s} for gap,metrics in exact_metrics.items() for s,v in metrics.items() if v is None]
    unavailable_source = [s for s,v in baselines.items() if v is None]
    if missing or unavailable or unavailable_source:
        return {'status':'ABSTAIN_INCOMPLETE_EVIDENCE','calibrationAvailable':False,'reason':'All 100 planned outcomes and every source/candidate selection must be available; no set or missing mass is dropped',
                'missingOutcomeIds':missing,'unavailableCandidateSelections':unavailable,'unavailableSourceSets':unavailable_source,'finalGap':None,'evaluations':evaluated}
    def fit(sets):
        rows = []
        for gap in GRID:
            metrics = exact_metrics[gap]
            losses = [s for s in sets if metrics[s]['success'] < baselines[s]['success']]
            gain = macro({s:metrics[s]['q']-baselines[s]['q'] for s in sets},sets)
            rows.append({'gap':gap,'gain':gain,'losses':losses,'admissible':not losses})
        safe = [r for r in rows if r['admissible']]
        best = max(safe,key=lambda r:(r['gain'],-r['gap'])) if safe else None
        return {'selectedGap':best['gap'] if best else 0,'admissibleFitAvailable':best is not None,
                'reason':'' if best else 'No grid candidate preserves acceptable-choice probability on every training set; zero fallback is not a safety claim',
                'candidates':[{'gap':r['gap'],'groupWeightedFirstChoiceGain':number(r['gain']),'acceptableChoiceLossSets':r['losses'],'admissible':r['admissible']} for r in rows]}
    all_sets = sorted(GROUPS); full = fit(all_sets); folds = []; heldout = {}; heldout_losses = []
    for group in sorted(set(GROUPS.values())):
        test = [s for s in all_sets if GROUPS[s] == group]; train = [s for s in all_sets if GROUPS[s] != group]
        trained = fit(train); chosen = exact_metrics[trained['selectedGap']]
        heldout.update({s:chosen[s]['q']-baselines[s]['q'] for s in test})
        losses = [s for s in test if chosen[s]['success'] < baselines[s]['success']]; heldout_losses.extend(losses)
        folds.append({'heldOutGroup':group,'trainingSets':train,'heldOutSets':test,'fit':trained,
                      'heldOutGroupFirstChoiceGain':number(macro({s:heldout[s] for s in test},test)), 'heldOutAcceptableChoiceLossSets':losses})
    pooled = macro(heldout,all_sets)
    permitted = pooled > 0 and not heldout_losses and full['admissibleFitAvailable'] and all(f['fit']['admissibleFitAvailable'] for f in folds)
    gap = full['selectedGap'] if permitted else 0
    return {'status':'CALIBRATED_NONZERO' if gap > 0 else 'FROZEN_ZERO','calibrationAvailable':True,'finalGap':gap,
            'fullDevelopmentFit':full,'leaveGroupOut':folds,'leaveGroupOutPooledFirstChoiceGain':number(pooled),'heldOutAcceptableChoiceLossSets':sorted(heldout_losses),
            'nonzeroGatePassed':permitted,'zeroIsNotASafetyClaim':gap == 0 and (not full['admissibleFitAvailable'] or bool(heldout_losses)),
            'policy':'Development-selected tolerance, not measured confidence uncertainty; equal weight per biological group and equal sets within group; exact rational objective ties favor smaller gaps',
            'evaluations':evaluated}


def run(request, root, output, node):
    root = Path(root).resolve(); output = Path(output)
    bundles, provenance, receipts, saved_ranks, evidence = load_predictions(root,request,node)
    prediction_request = {'bundles':bundles,'frozenAtUtc':request['startedAtUtc']}
    output.mkdir(parents=False,exist_ok=False)
    request_sha = save(output/'prediction-request.json',prediction_request)
    process = subprocess.run([node,str(HERE/'generate_grid.mjs')],input=json.dumps(prediction_request),capture_output=True,text=True,check=True,env={k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','NODE_PATH')})
    grid = strict_json(process.stdout)
    check([b['ranks'] for b in grid['baselines']] == saved_ranks, 'Saved v3 ranks do not replay from bound features')
    grid_sha = save(output/'prediction-grid.json',grid)
    grid_receipt_sha = save(output/'prediction-grid-receipt.json',{'schema':'confovhh-round3-development-grid-receipt-v1','predictionRequestSha256':request_sha,'predictionGridSha256':grid_sha,'sourceRankingReceiptSha256':sorted(receipts),'outcomeInputs':[]})
    # The whole grid is saved before opening any outcome map or analysis receipt.
    outcomes, outcome_evidence = authenticate_outcomes(root,request,provenance,receipts)
    result = analyze_grid(grid,outcomes,provenance['attempts'])
    analysis_sha = save(output/'analysis.json',result)
    completed_utc = dt.datetime.now(dt.timezone.utc).isoformat()
    files = {name:sha((output/name).read_bytes()) for name in ('prediction-request.json','prediction-grid.json','prediction-grid-receipt.json','analysis.json')}
    receipt = {'schema':'confovhh-round3-development-calibration-analysis-receipt-v1','status':result['status'],'calibrationAvailable':result['calibrationAvailable'],'finalGap':result['finalGap'],
               'sourceRankingReceiptSha256':sorted(receipts),**evidence,**outcome_evidence,'analysisSha256':analysis_sha,'predictionGridReceiptSha256':grid_receipt_sha,
               'protocolSha256':PROTOCOL,'generationRunId':provenance['generationRunId'],'files':files,'implementation':{str(p.relative_to(WORK)):sha(p.read_bytes()) for p in (HERE/'calibrate.py',HERE/'generate_grid.mjs',REPO/'scripts/external-ranking-v3/policy.mjs',REPO/'scripts/external-ranking-v3/score.mjs',REPO/'scripts/external-ranking-v3/contact-only.mjs',REPO/'scripts/external-ranking-v3/verify-contact-evidence.mjs',REPO/'scripts/external-ranking-v3/evaluate.py')},
               'startedAtUtc':request['startedAtUtc'],'frozenAtUtc':completed_utc,'prospectiveOutcomesRead':False,'independentValidationClaim':False,'productionDefaultChanged':False,
               'authenticationBoundary':'Caller-supplied hash-bound attestation authenticates outcome artifacts; this runner verifies map/receipt/coordinate/seed membership and does not reopen native structures'}
    receipt_sha = save(output/'analysis-receipt.json',receipt)
    bundle_files = dict(files)
    calibration = None
    if result['calibrationAvailable']:
        calibration = {'schema':'confovhh-source-gap-freeze-v1','calibrationId':request['calibrationId'],'generatorId':provenance['generatorId'],'producerVersion':provenance['producerVersion'],
                       'scoreContext':provenance['scoreContext'],'scoreName':provenance['scoreName'],'direction':provenance['direction'],'maximumPreferredScoreGap':result['finalGap'],
                       'developmentGroupIds':sorted(set(GROUPS.values())),'selectionRule':'development-selected-tolerance-not-confidence-uncertainty','frozenAtUtc':completed_utc,'evidenceSha256':receipt_sha}
        bundle_files['calibration.json'] = save(output/'calibration.json',calibration)
    bundle_files['analysis-receipt.json'] = receipt_sha
    save(output/'receipt.json',{'schema':'confovhh-round3-development-calibration-bundle-receipt-v1','status':result['status'],'files':bundle_files,'calibrationAvailable':calibration is not None,'finalGap':result['finalGap']})
    return receipt, calibration


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input',required=True); parser.add_argument('--artifacts',required=True); parser.add_argument('--output',required=True); parser.add_argument('--node',default='node')
    args = parser.parse_args()
    request = strict_json(Path(args.input).read_bytes())
    receipt, calibration = run(request,args.artifacts,args.output,args.node)
    print(json.dumps({'status':receipt['status'],'calibrationAvailable':receipt['calibrationAvailable'],'finalGap':receipt['finalGap']}))
