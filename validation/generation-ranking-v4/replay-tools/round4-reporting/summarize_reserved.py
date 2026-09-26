"""Released descriptive reserved summary, with fixed ties and complete attempts."""
from __future__ import annotations
import argparse
from collections import defaultdict
import csv
import io
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import report_common as c
import select_final as selection_module

TARGETS = ('ADGRV1_RE02', 'GPR158_NB20', 'MC4R_PN162')
CONTEXTS = {'ADGRV1_RE02': 'pair-confidence', 'GPR158_NB20': 'two-receptors-two-Nbs-confidence',
            'MC4R_PN162': 'receptor-targetNb-Gs-auxiliaryNb35-confidence'}
RELEASE_KEYS = {'schema', 'evaluationRole', 'authorizeReservedSummary', 'reportingFreeze',
                'selectionReceipt', 'finalPolicyFreeze', 'outcomeReceipt'}

def validate_release(root, release):
    c.exact(release, RELEASE_KEYS)
    c.check(release['schema'] == 'confovhh-round4-reserved-summary-release-v1'
            and release['evaluationRole'] == 'reserved' and release['authorizeReservedSummary'] is True,
            'Reserved reporting lacks separate explicit parent release')
    c.validate_freeze(root, release['reportingFreeze'])

def expected_roster(selection):
    arm = selection['pairGenerationArm']
    c.check(arm in ('baseline', 'broader', 'msa1024'), 'Unknown selected generation arm')
    result = {(target, 'baseline', seed) for target in TARGETS for seed in range(25)}
    if arm != 'baseline':
        result |= {('ADGRV1_RE02', arm, seed) for seed in range(25)}
    c.check(selection['reservedPlannedAttempts'] == len(result), 'Selection planned count differs')
    return result

def validate_plan(selection, plan):
    expected = expected_roster(selection)
    c.check(plan['schema'] == 'confovhh-round4-generation-plan-v1', 'Unknown reserved plan schema')
    c.check(type(plan['plannedAttempts']) is int and plan['plannedAttempts'] == len(expected), 'Reserved planned count differs')
    c.check({t['id'] for t in plan['targets']} == set(TARGETS) and len(plan['targets']) == 3, 'Reserved cases differ')
    jobs = plan['jobs']
    c.check(len(jobs) == len(expected) and len({j['jobId'] for j in jobs}) == len(expected), 'Missing or duplicate planned jobs')
    c.check(all(type(j['seed']) is int for j in jobs), 'Noninteger planned seed')
    c.check({(j['targetId'], j['armId'], j['seed']) for j in jobs} == expected, 'Reserved case/arm/seed membership differs')
    for job in jobs:
        c.check(job['jobId'] == f"{job['targetId']}__{job['armId']}__seed{job['seed']:02d}", 'Reserved job identifier differs')
    alternate = None if selection['pairGenerationArm'] == 'baseline' else selection['pairGenerationArm']
    c.check(plan['selectedAlternative'] == alternate, 'Selected generation alternative was omitted or changed')
    choice = plan['generationChoice']
    c.check(choice['selectedArmInDevelopment'] == selection['pairGenerationArm'] and choice['selectedAlternative'] == alternate
            and choice['includeSelectedAlternative'] is (alternate is not None)
            and choice['alternativePermittedOnlyFor'] == 'ADGRV1_RE02' and choice['otherContextsRetainBaseline'] is True,
            'Reserved plan does not preserve development generation choice')
    return {j['jobId']: j for j in jobs}

def join_reserved(rows, prepared, outcome_rows, jobs):
    predicted = {x['id']: x for x in rows}; inventory = {x['id']: x for x in prepared}; outcomes = {x['id']: x for x in outcome_rows}
    c.check(len(rows) == len(predicted) == len(prepared) == len(inventory) == len(outcome_rows) == len(outcomes) == len(jobs)
            and set(predicted) == set(inventory) == set(outcomes) == set(jobs), 'Reserved complete planned membership differs')
    labels = {}
    for ident, row in predicted.items():
        actual = outcomes[ident]; raw = inventory[ident]; job = jobs[ident]
        c.check((row['setId'], row['generationArm']) == (job['targetId'], job['armId']) and type(raw['seed']) is int
                and raw['seed'] == job['seed'] == actual['seed'], 'Reserved plan/row identity differs')
        c.check(row['profile']['scoreContext'] == CONTEXTS[row['setId']], 'Reserved context mislabeled')
        for key in ('setId', 'generationArm', 'seedBatch'):
            c.check(actual[key] == raw[key] == row[key], 'Reserved pool or batch differs')
        coordinate = raw['canonicalCoordinate']['sha256'] if raw['canonicalCoordinate'] else None
        c.check(actual['coordinateSha256'] == row['coordinateSha256'] == coordinate, 'Reserved coordinate identity differs')
        c.check(actual['producerStatus'] == raw['status'] and row['producerStatus'] == ('failed' if raw['status'] == 'interrupted' else raw['status']), 'Reserved production status differs')
        c.check(raw['status'] in ('generated', 'failed', 'interrupted'), 'Final reserved roster contains a nonterminal attempt')
        if actual['status'] == 'evaluated':
            c.check(row['producerStatus'] == 'generated' and c.finite(actual['DockQ']) and 0 <= actual['DockQ'] <= 1 and actual['reason'] == '', 'Invalid evaluated reserved outcome')
        else:
            c.check(actual['status'] == 'unavailable' and actual['DockQ'] is None and type(actual['reason']) is str and actual['reason'], 'Unavailable outcome lost its explanation')
        labels[ident] = actual['DockQ']
    return labels

def validate_ranks(rows, ranks):
    byid = {x['id']: x for x in ranks}
    c.check(len(byid) == len(ranks) == len(rows) and set(byid) == {r['id'] for r in rows}, 'Rank roster incomplete or duplicated')
    pools = defaultdict(list)
    for row in rows:
        rank = byid[row['id']]
        c.check(rank['poolId'] == row['poolId'] and rank['setId'] == row['setId'], 'Saved rank pool differs')
        c.check(rank['score'] is None or c.finite(rank['score']), 'Nonfinite/Boolean ranking score')
        if row['producerStatus'] != 'generated':
            c.check(rank['status'] == 'not-produced' and rank['score'] is rank['rankMin'] is rank['rankMax'] is None, 'Nonproduced attempt became ranked')
        else:
            pools[row['poolId']].append(rank)
    for pool in pools.values():
        populated = [r for r in pool if r['score'] is not None]
        c.check(not populated or len(populated) == len(pool), 'Partial produced-pool ranking is forbidden')
        ordered = sorted((r['score'] for r in populated), reverse=True)
        for rank in pool:
            if rank['score'] is None:
                c.check(rank['status'] == 'abstained' and rank['rankMin'] is rank['rankMax'] is None, 'Unavailable score acquired rank')
            else:
                positions = [i + 1 for i, v in enumerate(ordered) if v == rank['score']]
                c.check(type(rank['rankMin']) is int and type(rank['rankMax']) is int
                        and (rank['rankMin'], rank['rankMax']) == (min(positions), max(positions)), 'Scientific rank ties differ')
    return byid

def build_summary(selection, table, inventory, outcomes, plan, enrollment, policies, timings, metric_module):
    """Pure summary; a caller must authenticate all inputs before real use."""
    jobs = validate_plan(selection, plan); rows = table['rows']
    c.check(table['evaluationRole'] == 'reserved-evaluation' and table['outcomeInputs'] == []
            and inventory['evaluationRole'] == outcomes['evaluationRole'] == 'reserved' and inventory['snapshot'] is False, 'Wrong reserved data scope')
    labels = join_reserved(rows, inventory['rows'], outcomes['rows'], jobs)
    expected_policies = {'source'} if selection['selectedModel'] is None else {'source', 'challenger'}
    c.check(set(policies) == expected_policies, 'Policy roster differs from final selection')
    ranked = {name: validate_ranks(rows, ranks) for name, ranks in policies.items()}
    if 'challenger' in ranked:
        for row in rows:
            if row['setId'] != 'ADGRV1_RE02':
                source = ranked['source'][row['id']]; candidate = ranked['challenger'][row['id']]
                c.check(all(candidate[k] == source[k] for k in ('score', 'rankMin', 'rankMax', 'status')),
                        'Full-context challenger must preserve source fallback')
    targets = {x['id']: x for x in enrollment['targets']}
    c.check(set(targets) == set(TARGETS) and sum(x['learnerEligibleContext'] is True for x in targets.values()) == 1
            and targets['ADGRV1_RE02']['learnerEligibleContext'] is True, 'Enrollment learner scope differs')
    pool_rows = defaultdict(list)
    for row in rows:
        pool_rows[row['poolId']].append(row)
    c.check(len(pool_rows) == (3 if selection['pairGenerationArm'] == 'baseline' else 4), 'Unexpected reserved pool split')
    pools = []; comparisons = []
    for pool_id, pool in sorted(pool_rows.items()):
        first = pool[0]; target = targets[first['setId']]
        c.check(len(pool) == 25 and all((x['setId'], x['generationArm'], x['seedBatch'], x['profile']) ==
                                      (first['setId'], first['generationArm'], first['seedBatch'], first['profile']) for x in pool), 'Pool mixes target, arm, seed batch or producer profile')
        results = {}
        for name, ranks in ranked.items():
            m = metric_module.source_pool(pool, labels, ranks, timings)
            m['acceptableAmongEvaluated'] = None if m['evaluableCount'] == 0 else metric_module.rational(m['knownAcceptableCount']) / m['evaluableCount']
            modes = sorted({ranks[r['id']]['status'] for r in pool if r['producerStatus'] == 'generated'})
            results[name] = m
            pools.append({'poolId': pool_id, 'setId': first['setId'], 'biologicalGroupId': target['biologicalGroupId'],
                          'generationArm': first['generationArm'], 'seedBatch': first['seedBatch'], 'policy': name,
                          'scope': 'pair-learner-test' if first['setId'] == 'ADGRV1_RE02' else 'full-context-source-fallback',
                          'rankingModes': modes,
                          'learnedCandidateCount': sum(ranks[r['id']]['status'] == 'learned' for r in pool),
                          'sourceCandidateCount': sum(ranks[r['id']]['status'] == 'source' for r in pool), **m})
        if 'challenger' in results:
            differences = {}
            for name in ('firstDockQ', 'firstAcceptableProbability', 'top5MeanDockQ', 'top5ExpectedAcceptableCount', 'bestCandidateGap'):
                a, b = results['challenger'][name], results['source'][name]
                differences[name] = None if a is None or b is None else a - b
            comparisons.append({'poolId': pool_id, 'setId': first['setId'], 'generationArm': first['generationArm'],
                                'scope': 'pair-learner-test' if first['setId'] == 'ADGRV1_RE02' else 'full-context-source-fallback',
                                'challengerMinusSource': differences,
                                'selectionCoverageUnchanged': results['challenger']['selectionAvailable'] is results['source']['selectionAvailable']})
    outmap = {x['id']: x for x in outcomes['rows']}; invmap = {x['id']: x for x in inventory['rows']}
    attempts = [{'id': row['id'], 'setId': row['setId'], 'generationArm': row['generationArm'], 'seedBatch': row['seedBatch'],
                 'seed': jobs[row['id']]['seed'], 'producerStatus': row['producerStatus'], 'originalProducerStatus': invmap[row['id']]['status'],
                 'validityStatus': row['validityStatus'], 'geometryStatus': invmap[row['id']]['geometryStatus'],
                 'coordinateSha256': row['coordinateSha256'], 'outcomeStatus': outmap[row['id']]['status'],
                 'DockQ': labels[row['id']], 'outcomeUnavailableReason': outmap[row['id']]['reason'],
                 'predictionUnavailableReason': invmap[row['id']]['unavailableReason'], 'elapsedSeconds': timings[row['id']],
                 'ranks': {name: values[row['id']] for name, values in ranked.items()}} for row in sorted(rows, key=lambda r: r['id'])]
    produced = sum(r['producerStatus'] == 'generated' for r in rows)
    unavailable = [r['id'] for r in rows if r['producerStatus'] == 'generated' and labels[r['id']] is None]
    counts = {'planned': len(rows), 'generated': produced, 'failedGeneration': len(rows) - produced,
              'valid': sum(r['producerStatus'] == 'generated' and r['validityStatus'] == 'valid' for r in rows),
              'evaluated': sum(q is not None for q in labels.values()), 'generatedOutcomesUnavailable': len(unavailable),
              'allUnavailableIncludingNonproduced': sum(q is None for q in labels.values())}
    generation_comparisons = []
    if selection['pairGenerationArm'] != 'baseline':
        for policy in policies:
            pair = [p for p in pools if p['setId'] == 'ADGRV1_RE02' and p['policy'] == policy]
            baseline = next(p for p in pair if p['generationArm'] == 'baseline')
            alternate = next(p for p in pair if p['generationArm'] == selection['pairGenerationArm'])
            names = ('firstDockQ', 'firstAcceptableProbability', 'top5MeanDockQ', 'top5ExpectedAcceptableCount',
                     'bestCompleteDockQ', 'acceptablePerPlanned', 'bestCandidateGap')
            generation_comparisons.append({'setId': 'ADGRV1_RE02', 'policy': policy,
                'alternative': selection['pairGenerationArm'], 'alternativeMinusBaseline':
                {k: None if alternate[k] is None or baseline[k] is None else alternate[k] - baseline[k] for k in names},
                'descriptiveOnly': True, 'matchedSeedNumbersDoNotGuaranteeMatchedNoise': True})
    summary = {'schema': 'confovhh-round4-reserved-summary-v1', 'status': 'NEEDS_ATTENTION' if unavailable else 'COMPLETE_DESCRIPTIVE_SUMMARY',
               'counts': counts, 'selectedFamily': selection['selectedFamily'], 'selectedModel': selection['selectedModel'],
               'developmentSelectionStatus': selection['status'], 'pairGenerationArm': selection['pairGenerationArm'],
               'policies': list(policies), 'pools': pools, 'withinPoolPolicyComparisons': comparisons,
               'ADGRV1GenerationComparisons': generation_comparisons,
               'generatedOutcomesUnavailable': sorted(unavailable), 'allPlannedAttemptsRetained': True,
               'scopes': {'pairLearnerTest': {'setIds': ['ADGRV1_RE02'], 'biologicalGroups': 1},
                          'fullContextFallbackCoverage': {'setIds': ['GPR158_NB20', 'MC4R_PN162'], 'biologicalGroups': 2}},
               'caseQualifications': [{k: targets[t][k] for k in ('id', 'context', 'biologicalGroupId', 'learnerEligibleContext',
                                                               'limitations', 'historicalIndependenceCertified', 'predictorTrainingExposure')} for t in TARGETS],
               'populationConfidenceInterval': None, 'populationConfidenceIntervalReason': 'Only one learner-eligible biological group; poses and arms are not independent groups.',
               'referenceCoverageLimit': 'DockQ covers only frozen corresponding resolved residues; unavailable reference regions are not validated.',
               'metadataSourceExposureDisclosed': True, 'predictorTrainingNoveltyCertified': False,
               'generalSuperiorityClaim': False, 'productionDefaultChanged': False, 'modelsFit': 0,
               'nativeQualityMetricsRecomputed': False, 'rulesChanged': False}
    return metric_module.serialized(summary), attempts

def authenticated_summary(root, release):
    validate_release(root, release)
    selection, selected_receipt = selection_module.verify_selection(root, release['selectionReceipt'])
    c.check(selected_receipt['reportingFreeze'] == release['reportingFreeze'], 'Selection used another reporting freeze')
    outcomes_module = c.dependency(root, 'round4-outcomes/outcome_adapter.py', 'reserved_outcomes')
    outcomes, outcome_receipt = outcomes_module.verify_evaluation(root, release['outcomeReceipt'])
    c.check(outcomes['evaluationRole'] == outcome_receipt['evaluationRole'] == 'reserved', 'Development outcomes cannot become a reserved test')
    request = c.load(root, outcome_receipt['request'])
    c.check(request['finalSelectionFreeze'] == release['finalPolicyFreeze'], 'Final policy differs from the released outcome seal')
    policy = c.load(root, release['finalPolicyFreeze'])
    expected_models = [] if selection['selectedModel'] is None else [selection['selectedModel']]
    c.check(policy['allowedModelBindings'] == expected_models, 'Final policy model roster differs from frozen development selection')
    features = c.dependency(root, 'round4-ranking/prepare_features.py', 'reserved_features')
    table, source_saved, source = features.verify_source_seal(root, request['sourceRankingReceipt'])
    c.check(source['evaluationRole'] == 'reserved-evaluation' and source['snapshot'] is False
            and source['preparationReceipt'] == request['preparationReceipt'], 'Reserved source receipt/preparation differs')
    prep = features.prep_module(root)
    inventory, _ = prep.verify_preparation(root, source['preparationReceipt'])
    cohort, plan, _, _, _ = prep.verify_cohort(root, inventory['cohort'])
    c.check(outcomes['cohort'] == inventory['cohort'], 'Reserved outcome/source cohort differs')
    c.check(plan['generationChoice']['analysisReceipt'] == selected_receipt['generationAnalysisReceipt'], 'Reserved plan used another generation comparison')
    generation = c.load(root, selected_receipt['generationAnalysisReceipt'])
    generation_outputs = c.output_files(root, selected_receipt['generationAnalysisReceipt'], generation['files'], ('comparison.json', 'timing-bindings.json', 'REPORT.md'))
    c.check(plan['generationChoice']['comparison'] == generation_outputs['comparison.json'], 'Reserved generation comparison payload differs')
    policies = {'source': source_saved['ranks']}
    c.check(len(request['challengerRanks']) == len(expected_models), 'Challenger ranking roster differs')
    for b in request['challengerRanks']:
        saved = c.load(root, b)
        c.check(saved['modelBinding'] == selection['selectedModel'], 'Challenger ranking belongs to another model')
        policies['challenger'] = saved['ranks']
    enrollment = c.load(root, policy['reservedEnrollment'])
    timings = {}
    for row in inventory['rows']:
        raw = c.load(root, row['generationReceipt'])
        c.check(raw['jobId'] == row['id'], 'Reserved timing attempt differs')
        elapsed = raw.get('elapsedSeconds')
        c.check(raw.get('elapsed_seconds', elapsed) == elapsed and (elapsed is None or c.finite(elapsed) and elapsed >= 0), 'Invalid reserved timing')
        timings[row['id']] = elapsed
    metric_module = c.dependency(root, 'round4-analysis/analyze_generation.py', 'reserved_metrics')
    summary, attempts = build_summary(selection, table, inventory, outcomes, plan, enrollment, policies, timings, metric_module)
    return summary, attempts, {'sourceRankingReceipt': request['sourceRankingReceipt'], 'challengerRanks': request['challengerRanks'],
                               'rankingSeal': outcome_receipt['rankingSeal'], 'outcomeRelease': outcome_receipt['release'],
                               'cohort': outcomes['cohort'], 'generationPlan': cohort['generationPlan']}

def csv_bytes(summary):
    fields = ('setId', 'generationArm', 'seedBatch', 'scope', 'policy', 'plannedCount', 'generatedCount', 'failedCount',
              'validCount', 'evaluableCount', 'unavailableOutcomeCount', 'knownAcceptableCount', 'acceptablePerPlanned',
              'acceptableAmongEvaluated', 'selectionAvailable', 'firstDockQ', 'firstAcceptableProbability',
              'top5MeanDockQ', 'top5ExpectedAcceptableCount', 'bestAvailableDockQ', 'bestCompleteDockQ', 'bestCandidateGap')
    stream = io.StringIO(newline=''); writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore', lineterminator='\n')
    writer.writeheader(); writer.writerows(summary['pools']); return stream.getvalue().encode()

def render(summary):
    def number(value):
        return 'unavailable' if value is None else f'{value:.6f}'
    count = summary['counts']
    lines = ['# Reserved descriptive results', '',
             f"All {count['planned']} planned attempts are retained: {count['generated']} generated, {count['failedGeneration']} generation failures, {count['evaluated']} evaluated, and {count['generatedOutcomesUnavailable']} generated structures with unavailable outcomes.", '',
             f"Frozen candidate: **{summary['selectedFamily']}**. Development disposition: **{summary['developmentSelectionStatus']}**.", '',
             'ADGRV1 is the single learner-eligible biological test group. GPR158 and MC4R test complete-assembly source/fallback coverage separately. Different generation arms remain separate candidate pools.', '',
             '| Case | Arm | Policy | Evaluated / planned | First DockQ | Acceptable-first probability | Top5 mean DockQ | Top5 acceptable count | Best complete gap |',
             '|---|---|---|---:|---:|---:|---:|---:|---:|']
    for p in summary['pools']:
        lines.append(f"| {p['setId']} | {p['generationArm']} | {p['policy']} | {p['evaluableCount']} / {p['plannedCount']} | {number(p['firstDockQ'])} | {number(p['firstAcceptableProbability'])} | {number(p['top5MeanDockQ'])} | {number(p['top5ExpectedAcceptableCount'])} | {number(p['bestCandidateGap'])} |")
    lines += ['', 'Scientific ties are averaged, including partial ties at the top-five boundary. Acceptable means DockQ ≥ 0.23. Missing labels remain unavailable. First/top-five metrics require every label in the relevant tie support; best-complete gaps and acceptable fractions per planned attempt require all generated outcomes. Available-best values describe evaluated candidates only.', '',
              'The JSON and CSV preserve coverage, per-pool acceptable fractions, incomplete-outcome bounds, timing, policy differences and all attempt-level reasons. No population-level confidence interval is reported for one learner group.', '',
              'These cases have metadata/source exposure and uncertain predictor-training membership. DockQ validates only the frozen corresponding resolved regions. No general superiority or production-default promotion is claimed. No model was fitted or native quality metric recomputed by this reporter.', '']
    for target in summary['caseQualifications']:
        lines += [f"**{target['id']} qualifications:** " + ' '.join(target['limitations']), '']
    return '\n'.join(lines)

def documents(summary, attempts):
    return {'summary.json': c.json_bytes(summary), 'attempts.json': c.json_bytes(attempts),
            'POOLS.csv': csv_bytes(summary), 'REPORT.md': render(summary).encode()}

def metadata(release_binding, release, summary, inputs):
    return {'schema': 'confovhh-round4-reserved-summary-receipt-v1', 'status': summary['status'], 'release': release_binding,
            'reportingFreeze': release['reportingFreeze'], 'selectionReceipt': release['selectionReceipt'],
            'finalPolicyFreeze': release['finalPolicyFreeze'], 'outcomeReceipt': release['outcomeReceipt'], **inputs,
            'counts': summary['counts'], 'allPlannedAttemptsRetained': True, 'reservedOutcomesRead': True,
            'nativeQualityMetricsRecomputed': False, 'modelsFit': 0, 'rulesChanged': False, 'productionDefaultChanged': False}

def execute(root, release_path, output):
    rb = c.binding(root, release_path); release = c.load(root, rb)
    summary, attempts, inputs = authenticated_summary(root, release)
    return c.write_bundle(root, output, documents(summary, attempts), metadata(rb, release, summary, inputs))

def verify_reserved_summary(root, receipt_binding):
    receipt = c.load(root, receipt_binding)
    c.exact(receipt, ('schema', 'status', 'release', 'reportingFreeze', 'selectionReceipt', 'finalPolicyFreeze', 'outcomeReceipt',
                     'sourceRankingReceipt', 'challengerRanks', 'rankingSeal', 'outcomeRelease', 'cohort', 'generationPlan', 'counts',
                     'allPlannedAttemptsRetained', 'reservedOutcomesRead', 'nativeQualityMetricsRecomputed', 'modelsFit', 'rulesChanged', 'productionDefaultChanged', 'files'))
    release = c.load(root, receipt['release']); summary, attempts, inputs = authenticated_summary(root, release)
    c.check({k: v for k, v in receipt.items() if k != 'files'} == metadata(receipt['release'], release, summary, inputs), 'Reserved report receipt did not replay')
    c.replay_documents(root, receipt_binding, receipt, documents(summary, attempts))
    return summary, receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('summarize', 'verify')); parser.add_argument('--artifacts', type=Path, default=c.ROOT)
    parser.add_argument('--release', type=Path); parser.add_argument('--receipt', type=Path); parser.add_argument('--output', type=Path)
    args = parser.parse_args(); root = args.artifacts.resolve()
    if args.command == 'summarize':
        result = execute(root, args.release.resolve(), args.output.absolute())
    else:
        _, result = verify_reserved_summary(root, c.binding(root, args.receipt.absolute()))
    print({'status': result['status'], 'planned': result['counts']['planned'], 'modelsFit': 0})

if __name__ == '__main__':
    main()
