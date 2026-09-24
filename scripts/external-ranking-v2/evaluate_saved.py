#!/usr/bin/env python3
"""Join saved experimental ranks to separately generated reference outcomes.

This program does not score poses, optimize weights or alter rank artifacts.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import importlib.util
import json
import math
import pathlib
import sys
from collections import Counter

OLD_PATH = pathlib.Path(__file__).resolve().parents[1] / 'external-ranking' / 'analyze.py'
spec = importlib.util.spec_from_file_location('external_v1_analysis', OLD_PATH)
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)

ARMS = tuple(v1.ARMS) + ('hybrid-SG', 'G-paratope', 'G-polar', 'G-density', 'H-paratope', 'H-polar', 'H-density')


def summarize_saved(record, values):
    result = v1.analyze_arm(record, values)
    if record['status'] == 'ranked' and all(r['rank'] is not None for r in record['rows']):
        n = len(record['rows'])
        windows = [('top1', 0, min(1, n)), ('top5', 0, min(5, n)), ('top10', 0, min(10, n))]
        result['practicalWindows'] = {
            name: v1.weighted_summary(weights, values)
            for name, weights in v1.tied_windows(record['rows'], windows).items()
        }
    else:
        result['practicalWindows'] = None
    return result


def metric_row(result):
    out = {k: result[k] for k in ('setId', 'arm', 'status', 'complete', 'plannedCount', 'rankedCount', 'outcomeCount')}
    out['spearman'] = result['spearmanPreferenceVsDockQ']
    auc = result.get('pairwiseAUROCByThreshold')
    out['auroc023'] = auc['0.23'] if auc else None
    for name in ('top1', 'top5', 'top10'):
        item = result['practicalWindows'][name] if result['practicalWindows'] else None
        out[name+'MeanDockQ'] = item['meanDockQ'] if item else None
        out[name+'CorrectCount'] = item['correctCountsByThreshold']['0.23'] if item and item['correctCountsByThreshold'] else None
    return out


def biological_summary(analyses, membership):
    """Equal group weight, equal sets within group; no silent missing-set removal."""
    by_key = {(a['setId'], a['arm']): metric_row(a) for a in analyses}
    v1.check(len(by_key) == len(analyses), 'Duplicate set/arm')
    arms = sorted({a['arm'] for a in analyses})
    v1.check({a['setId'] for a in analyses} == set(membership), 'Group membership does not match all planned sets')
    groups = {}
    for set_id, group in membership.items():
        groups.setdefault(group, []).append(set_id)
    fields = ['spearman', 'auroc023', 'top1MeanDockQ', 'top1CorrectCount', 'top5MeanDockQ', 'top5CorrectCount', 'top10MeanDockQ', 'top10CorrectCount']
    output = []
    for arm in arms:
        group_rows = []
        for group, sets in sorted(groups.items()):
            v1.check(all((s, arm) in by_key for s in sets), 'Missing planned set/arm')
            row = {'group': group, 'setIds': sorted(sets), 'metrics': {}, 'undefinedOrMissingSets': {}}
            for field in fields:
                missing = [s for s in sets if by_key[s, arm][field] is None]
                row['undefinedOrMissingSets'][field] = missing
                row['metrics'][field] = None if missing else sum(by_key[s, arm][field] for s in sets)/len(sets)
            group_rows.append(row)
        means = {field: None if any(g['metrics'][field] is None for g in group_rows) else sum(g['metrics'][field] for g in group_rows)/len(group_rows) for field in fields}
        output.append({'arm': arm, 'groupCount': len(group_rows), 'groupMeans': group_rows, 'equalGroupMean': means})
    return output


def load_verified_json(directory, filename, digest):
    path = directory / filename
    v1.check(path.resolve() == path and path.is_file() and not path.is_symlink(), 'Missing or indirect artifact '+filename)
    raw = path.read_bytes()
    v1.check(v1.sha(raw) == digest, 'Changed saved artifact '+filename)
    return v1.strict_json(raw)


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def verify_extended_membership(data, score, original):
    """Check identities/missingness only; never derive feature or rank scores."""
    attempts = data['source-manifest.json']['attempts']
    planned = {a['id']: a for a in attempts}
    v1.check(len(planned) == len(attempts) == score['attemptCount'], 'Planned membership differs')
    v1.check(score['attemptsSha256'] == original['attemptsSha256'], 'Original attempt ledger digest differs')
    ledger = data['attempts.json']
    v1.check(len(ledger) == len(planned) and {a['id'] for a in ledger} == set(planned), 'Attempt ledger membership differs')
    for row in ledger:
        a = planned[row['id']]
        v1.check(row['setId'] == a['setId'] and row['generatorId'] == a['generatorId'] and row['producerStatus'] == a['status'], 'Attempt ledger identity differs')
    source_features = data['source-features.json']
    source_by_id = {f['id']: f for f in source_features}
    scored_ids = {a['id'] for a in ledger if a['status'] == 'scored'}
    v1.check(len(source_by_id) == len(source_features) == score['scoredCount'] and set(source_by_id) == scored_ids, 'Scored feature membership differs')
    features = data['features.json']
    v1.check(len(features) == len(planned) and {f['id'] for f in features} == set(planned), 'Extended feature membership differs')
    for feature in features:
        a = planned[feature['id']]
        source = source_by_id.get(a['id'])
        v1.check(feature['setId'] == a['setId'] and feature['generatorId'] == a['generatorId'] and feature['sourceFeature'] == source, 'Extended feature identity differs')
        v1.check(feature['coordinateSha256'] == (source['coordinateSha256'] if source else None), 'Extended coordinate identity differs')
        v1.check(feature['sourceAuditSha256'] == (original['artifactHashes'].get(a['id']+'/audit.json') if source else None), 'Extended audit identity differs')
    sets = {a['setId'] for a in attempts}
    components = {'S', 'G', 'P', 'F', 'D'}
    percentiles = data['percentiles.json']
    v1.check(len(percentiles) == len(sets)*len(components) and {(p['setId'], p['component']) for p in percentiles} == {(s, c) for s in sets for c in components}, 'Percentile component membership differs')
    for component in percentiles:
        expected = {a['id'] for a in attempts if a['setId'] == component['setId']}
        rows = component['rows']
        v1.check(len(rows) == len(expected) and {r['id'] for r in rows} == expected, 'Percentile row membership differs')
        complete = all(finite_number(r['value']) for r in rows)
        v1.check(component['status'] == ('complete' if complete else 'unavailable'), 'Percentile availability differs')
        v1.check(all(finite_number(r['percentile']) and 0 <= r['percentile'] <= 1 for r in rows) if complete else all(r['percentile'] is None for r in rows), 'Percentile missingness differs')


# Receipt and source identity checks are intentionally implemented separately
# from outcome metrics so neither scorer nor its input schema sees outcomes.
def preflight(manifest, root):
    v1.check(set(manifest) == {'schema', 'studyId', 'scoreReceipt', 'outcomeReceipt', 'biologicalGroups'}, 'Unexpected evaluation fields')
    v1.check(manifest['schema'] == 'confovhh-external-development-evaluation-v2', 'Wrong evaluation schema')
    score_path, score_raw = v1.bound(root, manifest['scoreReceipt'])
    outcome_path, outcome_raw = v1.bound(root, manifest['outcomeReceipt'])
    score = v1.strict_json(score_raw)
    outcome = v1.strict_json(outcome_raw)
    v1.check(score['schema'] == 'confovhh-external-development-score-receipt-v2', 'Wrong score receipt schema')
    v1.check(outcome['schema'] == 'confovhh-external-development-outcome-receipt-v1', 'Wrong outcome receipt schema')
    v1.check(score['studyId'] == outcome['studyId'] == manifest['studyId'], 'Study identity differs')
    v1.check(score['arms'] == list(ARMS) and score['outcomeInputs'] == [], 'Unexpected arms or outcome inputs')
    v1.check(score['sourceScoreReceiptSha256'] == outcome['scoreReceiptSha256'], 'Outcome and ranking source receipts differ')
    v1.check(score['sourceRanksSha256'] == outcome['sourceRanksSha256'], 'Original rankings differ between branches')
    files = {'manifest.json':'manifestSha256', 'features.json':'featuresSha256', 'attempts.json':'attemptsSha256',
             'ranks.json':'ranksSha256', 'percentiles.json':'percentilesSha256', 'source-manifest.json':'sourceManifestSha256',
             'source-features.json':'sourceFeaturesSha256', 'source-ranks.json':'sourceRanksSha256', 'source-score-receipt.json':'sourceScoreReceiptSha256'}
    data = {f:load_verified_json(score_path.parent,f,score[field]) for f,field in files.items()}
    v1.check(data['manifest.json']['sourceScoreReceipt']['sha256'] == score['sourceScoreReceiptSha256'], 'Selector input source differs')
    original = data['source-score-receipt.json']
    v1.check(original['manifestSha256'] == score['sourceManifestSha256'] and original['featuresSha256'] == score['sourceFeaturesSha256'] and original['ranksSha256'] == score['sourceRanksSha256'], 'Source copy identity differs')
    verify_extended_membership(data, score, original)
    reference = load_verified_json(outcome_path.parent,'reference-manifest.json',outcome['savedReferenceManifestSha256'])
    verified_source, verified_data, sets, references, _, _, _ = v1.preflight(reference,root)
    v1.check(verified_source == original and verified_data['ranks.json'] == data['source-ranks.json'] and verified_data['attempts.json'] == data['attempts.json'], 'Original source artifacts differ')
    values = load_verified_json(outcome_path.parent,'outcomes.json',outcome['files']['outcomes.json'])
    attempts = data['source-manifest.json']['attempts']
    by_id = {a['id']:a for a in attempts}
    v1.check(len(by_id) == len(attempts) == score['attemptCount'] == outcome['plannedCount'], 'Planned membership differs')
    v1.check(len(values) == len({v['id'] for v in values}) == len(attempts) and {v['id'] for v in values} == set(by_id), 'Outcome membership differs')
    for value in values:
        attempt = by_id[value['id']]
        v1.check(value['setId'] == attempt['setId'], 'Outcome set differs')
        if value['status'] == 'evaluated':
            v1.check(value['coordinateSha256'] == attempt['coordinate']['sha256'], 'Outcome coordinates differ')
            v1.check(value['referenceSha256'] == references[value['setId']]['reference']['sha256'], 'Outcome reference differs')
            v1.check(finite_number(value['DockQ']) and 0 <= value['DockQ'] <= 1, 'Invalid outcome scalar')
        else:
            v1.check(value['DockQ'] is None, 'Failed outcome contains a value')
    ranks = data['ranks.json']
    v1.check(len(ranks) == len(sets)*len(ARMS) and {(r['setId'],r['arm']) for r in ranks} == {(s,a) for s in sets for a in ARMS}, 'Rank set/arm membership differs')
    old = {(r['setId'],r['arm']):r for r in data['source-ranks.json']}
    for record in ranks:
        v1.verify_saved_rank_record(record,[a['id'] for a in attempts if a['setId'] == record['setId']])
        if record['arm'] in v1.ARMS:
            v1.check(record == old[record['setId'],record['arm']], 'Original five ranking changed')
    members = manifest['biologicalGroups']
    v1.check(all(set(m) == {'setId','group'} and isinstance(m['group'],str) and m['group'] for m in members), 'Invalid biological grouping')
    membership = {m['setId']:m['group'] for m in members}
    v1.check(len(membership) == len(members) and set(membership) == set(sets), 'Group membership differs')
    return score, outcome, ranks, values, membership


def run(manifest_path, root, output):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    raw = manifest_path.read_bytes()
    manifest = v1.strict_json(raw)
    root = root.resolve(strict=True)
    score, outcome, ranks, values, membership = preflight(manifest,root)
    by_id = {v['id']:v['DockQ'] for v in values}
    analyses = [summarize_saved(r,by_id) for r in ranks]
    result = {'schema':'confovhh-external-development-analysis-v2','studyId':manifest['studyId'],
              'plannedCount':len(values),'biologicalGroupCount':len(set(membership.values())),
              'outcomeStatusCounts':dict(Counter(v['status'] for v in values)), 'arms':analyses,
              'metrics':[metric_row(a) for a in analyses], 'groupSummary':biological_summary(analyses,membership),
              'claims':{'developmentOnly':True,'independentValidation':False,'productionScoringChanged':False,
                        'scoringCalculatedHere':False,'weightsFittedHere':False,'randomPoseSplit':False,'poseLevelSignificance':False},
              'practicalMetrics':'Uniform expected membership within exact scientific ties; first choice, top5 and top10; correct means DockQ >= 0.23',
              'groupPolicy':'Equal groups and equal sets within each group, preserving undefined or missing values; no complete-case macro average'}
    output.mkdir(parents=False,exist_ok=False)
    hashes = {'evaluation-manifest.json':v1.save(output/'evaluation-manifest.json',manifest),
              'analysis.json':v1.save(output/'analysis.json',result), 'metrics.json':v1.save(output/'metrics.json',result['metrics'])}
    receipt = {'schema':'confovhh-external-development-evaluation-receipt-v2','studyId':manifest['studyId'],
               'startedAtUtc':started,'completedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'inputManifestSha256':v1.sha(raw),'scoreReceiptSha256':manifest['scoreReceipt']['sha256'],
               'outcomeReceiptSha256':manifest['outcomeReceipt']['sha256'],'sourceRanksSha256':score['ranksSha256'],
               'sourceOutcomesSha256':outcome['files']['outcomes.json'],
               'analyzerSha256':v1.sha(pathlib.Path(__file__).read_bytes()),'originalAnalyzerSha256':v1.sha(OLD_PATH.read_bytes()),
               'files':hashes,'plannedCount':len(values),'armCount':len(ARMS),'setCount':len(membership),
               'status':'COMPLETE' if all(a['complete'] for a in analyses) else 'RECORDED_WITH_FAILURES_OR_ABSTENTIONS'}
    v1.save(output/'receipt.json',receipt)
    return receipt


if __name__ == '__main__':
    try:
        parser=argparse.ArgumentParser()
        parser.add_argument('--input',required=True,type=pathlib.Path)
        parser.add_argument('--artifacts',required=True,type=pathlib.Path)
        parser.add_argument('--output',required=True,type=pathlib.Path)
        args=parser.parse_args()
        print(json.dumps(run(args.input,args.artifacts,args.output),indent=2))
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}',file=sys.stderr)
        sys.exit(1)
