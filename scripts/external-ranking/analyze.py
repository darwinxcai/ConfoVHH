#!/usr/bin/env python3
"""Reference-only external development evaluation. Never computes or changes ranks."""
from __future__ import annotations
import argparse, datetime, hashlib, importlib.metadata, json, math, os, pathlib, platform, subprocess, sys, time
from collections import Counter

THRESHOLDS = (0.23, 0.49, 0.80)
ARMS = ('frozen-v06', 'burial-only', 'producer-score', 'clash-fraction-v1', 'overlap-burial-v1')


def check(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            check(k not in out, 'Duplicate JSON key: ' + k)
            out[k] = v
        return out
    def invalid(value):
        raise ValueError('Nonfinite JSON constant: ' + value)
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    raw = (json.dumps(value, indent=2, allow_nan=False) + '\n').encode()
    with path.open('xb') as stream:
        stream.write(raw)
    return sha(raw)


def bound(root, binding):
    check(set(binding) in ({'path', 'bytes', 'sha256'}, {'path', 'bytes', 'sha256', 'format'}), 'Invalid file binding fields')
    rel = pathlib.Path(binding['path'])
    check(not rel.is_absolute() and '..' not in rel.parts, 'Escaping artifact path')
    path = root / rel
    check(path.resolve() == path and path.is_file() and not path.is_symlink(), 'Missing or indirect artifact')
    raw = path.read_bytes()
    check(len(raw) == binding['bytes'] and sha(raw) == binding['sha256'], 'Changed bound file: ' + str(rel))
    return path, raw


def rank_average(values):
    ordered = sorted(range(len(values)), key=lambda i: values[i])
    result = [0.0] * len(values)
    start = 0
    while start < len(values):
        end = start + 1
        while end < len(values) and values[ordered[end]] == values[ordered[start]]:
            end += 1
        for i in ordered[start:end]:
            result[i] = (start + 1 + end) / 2
        start = end
    return result


def pearson(a, b):
    if len(a) < 2:
        return None
    am, bm = sum(a)/len(a), sum(b)/len(b)
    da, db = [x-am for x in a], [x-bm for x in b]
    denominator = math.sqrt(sum(x*x for x in da) * sum(x*x for x in db))
    return sum(x*y for x, y in zip(da, db))/denominator if denominator else None


def pairwise_auc(ranks, labels):
    positives = [r for r, label in zip(ranks, labels) if label]
    negatives = [r for r, label in zip(ranks, labels) if not label]
    if not positives or not negatives:
        return None
    return sum(1 if a < b else 0.5 if a == b else 0 for a in positives for b in negatives)/(len(positives)*len(negatives))


def tied_windows(rows, windows):
    """Expected membership for uniform ordering within exact scientific ties."""
    groups = {}
    for row in rows:
        groups.setdefault(row['rank'], []).append(row['id'])
    result = {name: {} for name, _, _ in windows}
    start = 0
    for rank in sorted(groups):
        ids = groups[rank]
        end = start + len(ids)
        for name, left, right in windows:
            weight = max(0.0, min(end, right)-max(start, left))/len(ids)
            if weight:
                result[name].update({id_: weight for id_ in ids})
        start = end
    return result


def weighted_summary(weights, outcomes):
    size = sum(weights.values())
    available = {id_: w for id_, w in weights.items() if outcomes.get(id_) is not None}
    missing_mass = size - sum(available.values())
    known_sum = sum(w*outcomes[id_] for id_, w in available.items())
    counts = {'incorrect': 0.0, 'acceptable': 0.0, 'medium': 0.0, 'high': 0.0}
    threshold_counts = {str(t): 0.0 for t in THRESHOLDS}
    for id_, weight in available.items():
        value = outcomes[id_]
        counts['incorrect' if value < .23 else 'acceptable' if value < .49 else 'medium' if value < .8 else 'high'] += weight
        for t in THRESHOLDS:
            if value >= t:
                threshold_counts[str(t)] += weight
    complete = missing_mass < 1e-12
    return {'size': size, 'availableOutcomeMass': sum(available.values()), 'missingOutcomeMass': missing_mass,
            'complete': complete, 'meanDockQ': known_sum/size if complete and size else None,
            'meanDockQBounds': [known_sum/size, (known_sum+missing_mass)/size] if size else None,
            'qualityCounts': counts if complete else None, 'knownQualityCounts': counts,
            'correctCountsByThreshold': threshold_counts if complete else None,
            'correctCountBoundsByThreshold': {t: [n, n+missing_mass] for t, n in threshold_counts.items()},
            'correctFractionByThreshold': {t: n/size for t, n in threshold_counts.items()} if complete and size else None,
            'weights': weights}


def analyze_arm(rank_record, outcomes):
    rows = rank_record['rows']
    ids = [r['id'] for r in rows]
    available = [id_ for id_ in ids if outcomes.get(id_) is not None]
    missing_scores = [r['id'] for r in rows if r['rank'] is None]
    missing_outcomes = [id_ for id_ in ids if outcomes.get(id_) is None]
    complete = not missing_scores and not missing_outcomes and rank_record['status'] == 'ranked'
    output = {k: rank_record[k] for k in ('setId', 'arm', 'scoreName', 'direction', 'status', 'reason')}
    output.update({'plannedCount': len(ids), 'rankedCount': len(ids)-len(missing_scores), 'outcomeCount': len(available),
                   'missingScoreIds': missing_scores, 'missingOutcomeIds': missing_outcomes,
                   'complete': complete, 'spearmanRankVsDockQ': None, 'spearmanPreferenceVsDockQ': None,
                   'pairwiseAUROCByThreshold': None, 'bestAvailable': None,
                   'metricScope': 'All planned rows; no complete-case subset or significance tests'})
    uniform = {id_: 1.0 for id_ in ids}
    output['randomExpectation'] = weighted_summary(uniform, outcomes)
    selected = rank_record['selected']
    if selected:
        summary = weighted_summary({id_: 1/len(selected) for id_ in selected}, outcomes)
        summary['ids'] = selected
        summary['dockqRange'] = [min(outcomes[id_] for id_ in selected), max(outcomes[id_] for id_ in selected)] if summary['complete'] else None
        output['selected'] = summary
    else:
        output['selected'] = {'ids': [], 'complete': False, 'meanDockQ': None, 'dockqRange': None,
                              'meanDockQBounds': [0, 1], 'reason': 'Arm abstains; no selected pose'}
    if not missing_scores:
        n = len(ids)
        windows = [('top10', 0, min(10, n)), ('topThird', 0, n/3), ('middleThird', n/3, 2*n/3), ('bottomThird', 2*n/3, n)]
        output['windows'] = {name: weighted_summary(weights, outcomes) for name, weights in tied_windows(rows, windows).items()}
    else:
        output['windows'] = None
    if complete:
        ranks, quality = [r['rank'] for r in rows], [outcomes[id_] for id_ in ids]
        corr = pearson(rank_average(ranks), rank_average(quality))
        output['spearmanRankVsDockQ'] = corr
        output['spearmanPreferenceVsDockQ'] = -corr if corr is not None else None
        output['spearmanUndefinedReason'] = 'Constant rank, constant quality or fewer than two rows' if corr is None else None
        output['pairwiseAUROCByThreshold'] = {str(t): pairwise_auc(ranks, [x >= t for x in quality]) for t in THRESHOLDS}
        output['qualityCounts'] = output['randomExpectation']['qualityCounts']
        best = max(quality)
        best_ids = [id_ for id_ in ids if outcomes[id_] == best]
        intervals = {}
        for row in rows:
            if row['id'] in best_ids:
                better = sum(r['rank'] < row['rank'] for r in rows)
                tied = sum(r['rank'] == row['rank'] for r in rows)
                intervals[row['id']] = [better+1, better+tied]
        output['bestAvailable'] = {'DockQ': best, 'ids': best_ids, 'rankIntervals': intervals,
                                   'overallRankInterval': [min(x[0] for x in intervals.values()), max(x[1] for x in intervals.values())]}
    return output


def verify_saved_rank_record(record, expected_ids):
    check(set(record['rows'][i]['id'] for i in range(len(record['rows']))) == set(expected_ids) and len(record['rows']) == len(expected_ids), 'Rank rows differ from planned rows')
    def comparison(key):
        return tuple((0, 0) if value is None else (1, value) for value in key)
    scored = sorted((r for r in record['rows'] if r['key'] is not None), key=lambda r: comparison(r['key']), reverse=True)
    dense, previous = 0, None
    for row in scored:
        if previous is None or row['key'] != previous:
            dense += 1
        check(row['rank'] == dense and row['status'] == 'scored', 'Saved rank inconsistent with saved scientific key')
        previous = row['key']
    check(all(r['rank'] is None for r in record['rows'] if r['key'] is None), 'Unavailable score has rank')
    expected = sorted(r['id'] for r in scored if r['rank'] == 1) if len(scored) == len(expected_ids) else []
    check(record['selected'] == expected, 'Saved selected tie set inconsistent')
    check(record['status'] == ('ranked' if len(scored) == len(expected_ids) else 'abstain'), 'Saved ranking status inconsistent')


def model_index(path, format_, wanted):
    # Inspect only model identifiers, without rewriting or extracting coordinates.
    if format_ == 'pdb':
        ids = [line[10:14].strip() for line in path.read_text().splitlines() if line.startswith('MODEL ')]
        if not ids:
            ids = ['1']
    else:
        from Bio.PDB.MMCIF2Dict import MMCIF2Dict
        values = MMCIF2Dict(str(path)).get('_atom_site.pdbx_PDB_model_num', ['1'])
        ids = list(dict.fromkeys(values))
    check(len(ids) == len(set(ids)) and wanted in ids, 'Selected coordinate model absent or duplicated')
    return ids.index(wanted)


def evaluate_one(job):
    check(importlib.metadata.version('DockQ') == '2.1.3', 'DockQ version differs from 2.1.3')
    from DockQ.DockQ import load_PDB, run_on_all_native_interfaces
    model_index_ = model_index(pathlib.Path(job['coordinate']), job['coordinateFormat'], job['modelModelId'])
    native_index = model_index(pathlib.Path(job['reference']), job['referenceFormat'], job['referenceModelId'])
    check(model_index_ == native_index == 0, 'CLI/API crosscheck contract requires selected first model')
    model = load_PDB(job['coordinate'], chains=job['modelChains'], n_model=model_index_)
    native = load_PDB(job['reference'], chains=job['nativeChains'], n_model=native_index)
    chain_map = dict(zip(job['nativeChains'], job['modelChains']))
    result, total = run_on_all_native_interfaces(model, native, chain_map=chain_map, no_align=False)
    key = ''.join(job['nativeChains'])
    check(len(result) == 1 and key in result, 'Reference has no uniquely mapped non-null receptor/VHH interface')
    data = result[key]
    value = float(data['DockQ'])
    check(math.isfinite(value) and 0 <= value <= 1, 'Invalid DockQ value')
    return {'DockQ': value, 'interfaceKey': key, 'chainMapNativeToModel': chain_map, 'noAlign': False,
            'modelIndex': model_index_, 'referenceModelIndex': native_index,
            'interfaceMetrics': {k: float(data[k]) for k in ('DockQ', 'F1', 'fnat', 'irms', 'lrms') if k in data}}


def preflight(ref_manifest, artifact_root):
    check(set(ref_manifest) == {'schema', 'studyId', 'scoreReceipt', 'sets'}, 'Unexpected reference manifest fields')
    check(ref_manifest['schema'] == 'confovhh-external-development-reference-v1', 'Unexpected reference manifest schema')
    receipt_path, receipt_bytes = bound(artifact_root, ref_manifest['scoreReceipt'])
    receipt = strict_json(receipt_bytes)
    check(receipt['schema'] == 'confovhh-external-development-score-receipt-v1' and receipt['studyId'] == ref_manifest['studyId'], 'Score receipt identity differs')
    data = {}
    for filename, digest_field in [('manifest.json', 'manifestSha256'), ('features.json', 'featuresSha256'), ('attempts.json', 'attemptsSha256'), ('ranks.json', 'ranksSha256')]:
        p = receipt_path.parent / filename
        check(p.resolve() == p and p.is_file(), 'Missing or indirect saved ranking artifact')
        raw = p.read_bytes()
        check(sha(raw) == receipt[digest_field], 'Changed saved ranking artifact: ' + filename)
        data[filename] = strict_json(raw)
    for relative, digest in receipt['artifactHashes'].items():
        p = receipt_path.parent / relative
        check(not pathlib.Path(relative).is_absolute() and '..' not in pathlib.Path(relative).parts and p.resolve() == p and sha(p.read_bytes()) == digest, 'Changed score provenance artifact')
    inputs = data['manifest.json']
    check(inputs['studyId'] == ref_manifest['studyId'], 'Study identity mismatch')
    check(set(receipt['arms']) == set(ARMS), 'Wrong set of methods')
    check(receipt.get('outcomeInputs') == [], 'Scoring receipt declares outcome inputs')
    attempts = inputs['attempts']
    check(len({a['id'] for a in attempts}) == len(attempts) == receipt['attemptCount'], 'Attempt membership mismatch')
    check({a['id'] for a in data['attempts.json']} == {a['id'] for a in attempts} and len(data['attempts.json']) == len(attempts), 'Scoring disposition membership mismatch')
    input_sets = {s['id']: s for s in inputs['sets']}
    references = {s['id']: s for s in ref_manifest['sets']}
    check(len(references) == len(ref_manifest['sets']) and set(references) == set(input_sets), 'Reference sets differ from all planned sets')
    reference_paths = {}
    for id_, item in references.items():
        check(set(item) == {'id', 'reference', 'referenceReceptorChain', 'referenceVhhChain', 'referenceModelId'}, 'Unexpected reference set fields')
        check(item['referenceReceptorChain'] != item['referenceVhhChain'], 'Reference roles coincide')
        check(all(isinstance(c, str) and len(c) == 1 for c in [item['referenceReceptorChain'], item['referenceVhhChain'], input_sets[id_]['receptorChain'], input_sets[id_]['vhhChain']]), 'DockQ CLI/API chain identity contract requires single characters')
        reference_paths[id_] = bound(artifact_root, item['reference'])[0]
    coordinate_paths, coordinate_issues = {}, {}
    scoring_dispositions = {a['id']: a for a in data['attempts.json']}
    for item in attempts:
        if item['coordinate'] is not None:
            try:
                coordinate_paths[item['id']] = bound(artifact_root, item['coordinate'])[0]
            except (ValueError, OSError) as exc:
                if scoring_dispositions[item['id']]['status'] == 'scored':
                    raise
                coordinate_issues[item['id']] = f'{type(exc).__name__}: {exc}'
    ranks = data['ranks.json']
    check(len(ranks) == len(input_sets)*len(ARMS) and {(r['setId'], r['arm']) for r in ranks} == {(s, arm) for s in input_sets for arm in ARMS}, 'Saved ranking set/method membership mismatch')
    for r in ranks:
        verify_saved_rank_record(r, [a['id'] for a in attempts if a['setId'] == r['setId']])
    return receipt, data, input_sets, references, reference_paths, coordinate_paths, coordinate_issues


def run(ref_path, artifact_root, output):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    began = time.monotonic()
    ref_bytes = ref_path.read_bytes()
    ref_manifest = strict_json(ref_bytes)
    artifact_root = artifact_root.resolve(strict=True)
    receipt, data, sets, references, reference_paths, coordinate_paths, coordinate_issues = preflight(ref_manifest, artifact_root)
    versions = {x: importlib.metadata.version(x) for x in ('DockQ', 'biopython', 'numpy')}
    check(versions == {'DockQ': '2.1.3', 'biopython': '1.88', 'numpy': '1.26.4'}, 'Reference environment differs from pinned dependencies: '+str(versions))
    output.mkdir(parents=False, exist_ok=False)
    saved_reference_sha = save(output/'reference-manifest.json', ref_manifest)
    saved_ranks_sha = save(output/'saved-ranks.json', data['ranks.json'])
    outcomes, checks = [], []
    checked_sets = set()
    script = pathlib.Path(__file__).resolve()
    for attempt in data['manifest.json']['attempts']:
        id_, set_id = attempt['id'], attempt['setId']
        row = {'id': id_, 'setId': set_id, 'producerStatus': attempt['status'], 'status': 'not-evaluated', 'reason': attempt['reason'], 'DockQ': None}
        if attempt['status'] == 'generated' and id_ in coordinate_paths:
            directory = output/id_
            directory.mkdir()
            source, ref = sets[set_id], references[set_id]
            job = {'coordinate': str(coordinate_paths[id_]), 'coordinateFormat': attempt['coordinate']['format'], 'reference': str(reference_paths[set_id]), 'referenceFormat': ref['reference']['format'],
                   'modelChains': [source['receptorChain'], source['vhhChain']], 'nativeChains': [ref['referenceReceptorChain'], ref['referenceVhhChain']],
                   'modelModelId': source['selectedModelId'], 'referenceModelId': ref['referenceModelId']}
            save(directory/'job.json', job)
            try:
                result = subprocess.run([sys.executable, str(script), '_one', str(directory/'job.json')], capture_output=True, text=True, timeout=120)
                (directory/'api.stdout').write_text(result.stdout)
                (directory/'api.stderr').write_text(result.stderr)
                check(result.returncode == 0, 'DockQ API subprocess failed: '+result.stderr[-1000:])
                answer = strict_json(result.stdout)
                if set_id not in checked_sets:
                    cli_path = directory/'cli.json'
                    command = [sys.executable, '-m', 'DockQ', job['coordinate'], job['reference'], '--mapping', ''.join(job['modelChains'])+':'+''.join(job['nativeChains']), '--json', str(cli_path), '--n_cpu', '1']
                    cli = subprocess.run(command, capture_output=True, text=True, timeout=120)
                    (directory/'cli.stdout').write_text(cli.stdout)
                    (directory/'cli.stderr').write_text(cli.stderr)
                    check(cli.returncode == 0 and cli_path.is_file(), 'DockQ CLI crosscheck failed')
                    cli_data = strict_json(cli_path.read_bytes())
                    cli_results = cli_data.get('best_result', {})
                    cli_value = float(cli_results[answer['interfaceKey']]['DockQ'])
                    difference = abs(cli_value-answer['DockQ'])
                    check(difference <= 1e-12, 'DockQ CLI/API crosscheck differs by '+str(difference))
                    checked_sets.add(set_id)
                    checks.append({'setId': set_id, 'id': id_, 'apiDockQ': answer['DockQ'], 'cliDockQ': cli_value, 'absoluteDifference': difference, 'command': command})
                row.update(answer)
                row.update({'status': 'evaluated', 'reason': '', 'coordinateSha256': attempt['coordinate']['sha256'], 'referenceSha256': ref['reference']['sha256']})
            except Exception as exc:
                row.update({'status': 'evaluation-failed', 'reason': f'{type(exc).__name__}: {exc}', 'DockQ': None})
            save(directory/'outcome.json', row)
        elif attempt['status'] == 'generated':
            row.update({'status': 'evaluation-failed', 'reason': coordinate_issues.get(id_, 'Generated attempt has no coordinate binding')})
        outcomes.append(row)
        with (output/'outcomes.jsonl').open('a') as stream:
            stream.write(json.dumps(row, allow_nan=False)+'\n')
        print(json.dumps({'processed': len(outcomes), 'planned': len(data['manifest.json']['attempts']), 'id': id_, 'status': row['status']}), flush=True)
    values = {r['id']: r['DockQ'] for r in outcomes}
    analysis = {'schema': 'confovhh-external-development-analysis-v1', 'studyId': ref_manifest['studyId'],
                'plannedCount': len(outcomes), 'outcomeStatusCounts': dict(Counter(r['status'] for r in outcomes)),
                'thresholds': list(THRESHOLDS), 'arms': [analyze_arm(r, values) for r in data['ranks.json']],
                'claims': {'developmentOnly': True, 'independentValidation': False, 'poseLevelSignificance': False, 'rankingReadBeforeOutcomes': True, 'sequenceAlignment': 'DockQ 2.1.3 default no_align=False', 'chainSearch': False},
                'metricDefinitions': {'spearmanRankVsDockQ': 'Negative is favorable: smaller rank is preferred; average ranks for ties', 'spearmanPreferenceVsDockQ': 'Sign-reversed Spearman, positive is favorable', 'pairwiseAUROCByThreshold': 'Preferred correct/incorrect pairs; exact scientific ties count 0.5; null when only one class', 'qualityCounts': 'incorrect<.23; acceptable [.23,.49); medium [.49,.8); high>=.8', 'windows': 'Equal thirds of all planned rows; fractional inclusion at exact scientific ties and fractional size boundaries; top10 size min(10,N)', 'missingness': 'Rank correlations/AUC/best pose withheld if any planned rank or outcome is missing; weighted bounds preserve missing outcome mass'}}
    hashes = {'outcomes.json': save(output/'outcomes.json', outcomes), 'analysis.json': save(output/'analysis.json', analysis), 'crosschecks.json': save(output/'crosschecks.json', checks)}
    result = {'schema': 'confovhh-external-development-outcome-receipt-v1', 'studyId': ref_manifest['studyId'], 'startedAtUtc': started,
              'completedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'elapsedSeconds': time.monotonic()-began,
              'referenceManifestSha256': sha(ref_bytes), 'scoreReceiptSha256': ref_manifest['scoreReceipt']['sha256'],
              'sourceRanksSha256': receipt['ranksSha256'], 'savedRanksSha256': saved_ranks_sha,
              'savedReferenceManifestSha256': saved_reference_sha, 'analyzerSha256': sha(script.read_bytes()), 'versions': versions,
              'python': platform.python_version(), 'plannedCount': len(outcomes), 'outcomeStatusCounts': analysis['outcomeStatusCounts'],
              'files': hashes, 'crosscheckedSets': sorted(checked_sets), 'status': 'COMPLETE' if all(r['status']=='evaluated' for r in outcomes) and checked_sets==set(sets) else 'RECORDED_WITH_FAILURES',
              'outcomePolicy': 'Original unchanged coordinates; selected first model; fixed native-to-model chain mapping; default sequence alignment; source supplied DockQ not used'}
    save(output/'receipt.json', result)
    return result


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '_one':
            print(json.dumps(evaluate_one(strict_json(pathlib.Path(sys.argv[2]).read_bytes())), allow_nan=False))
        else:
            parser = argparse.ArgumentParser()
            parser.add_argument('--references', required=True, type=pathlib.Path)
            parser.add_argument('--artifact-root', required=True, type=pathlib.Path)
            parser.add_argument('--output', required=True, type=pathlib.Path)
            args = parser.parse_args()
            print(json.dumps(run(args.references, args.artifact_root, args.output), indent=2))
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
