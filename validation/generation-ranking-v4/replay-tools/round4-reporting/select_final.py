"""Apply frozen development selection gates; never fit, authorize or launch."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import report_common as c

FAMILIES = ('confidence', 'interface')
COMMON_RELEASE = {'schema', 'evaluationRole', 'reportingFreeze', 'generationAnalysisReceipt', 'combinedJoinReceipt'}
NORMAL_RELEASE = COMMON_RELEASE | {'authorizeFinalSelection', 'fitReceipt', 'fitVerification'}
INCOMPLETE_RELEASE = COMMON_RELEASE | {'authorizeIncompleteSourceDisposition', 'reason'}

def validate_release(root, release):
    incomplete = release.get('schema') == 'confovhh-round4-incomplete-selection-release-v1'
    c.exact(release, INCOMPLETE_RELEASE if incomplete else NORMAL_RELEASE)
    c.check(release['evaluationRole'] == 'development', 'Reserved outcomes cannot select a model')
    if incomplete:
        c.check(release['authorizeIncompleteSourceDisposition'] is True
                and type(release['reason']) is str and release['reason'].strip(), 'Incomplete disposition requires separate explicit parent authorization and reason')
    else:
        c.check(release['schema'] == 'confovhh-round4-final-selection-release-v1'
                and release['authorizeFinalSelection'] is True, 'Final selection lacks explicit parent release')
    c.validate_freeze(root, release['reportingFreeze'])
    # Authorization and implementation are checked before any outcome artifact.
    return incomplete

def replay_generation(root, receipt_binding):
    g = c.dependency(root, 'round4-analysis/analyze_generation.py', 'generation')
    receipt = c.load(root, receipt_binding)
    c.exact(receipt, ('schema', 'status', 'release', 'analysisFreeze', 'sourceRankingReceipt', 'outcomeReceipt', 'generationPlan', 'grouping',
                     'files', 'planned', 'old300Included', 'reservedOutcomesRead', 'sourceRanksRecomputedAndVerified', 'outcomesAuthenticated'))
    c.check(receipt['schema'] == 'confovhh-round4-generation-analysis-receipt-v1' and receipt['status'] == 'COMPLETE'
            and type(receipt['planned']) is int and receipt['planned'] == 900 and receipt['old300Included'] is False
            and receipt['reservedOutcomesRead'] is False and receipt['sourceRanksRecomputedAndVerified'] is True
            and receipt['outcomesAuthenticated'] is True, 'Generation comparison is incomplete or out of scope')
    release = c.load(root, receipt['release'])
    g.validate_release(root, release)
    for key in ('analysisFreeze', 'sourceRankingReceipt', 'outcomeReceipt', 'generationPlan', 'grouping'):
        c.check(receipt[key] == release[key], 'Generation receipt/release differs: ' + key)
    plan = c.load(root, release['generationPlan']); grouping = c.load(root, release['grouping'])
    features = c.dependency(root, 'round4-ranking/prepare_features.py', 'features')
    outcomes = c.dependency(root, 'round4-outcomes/outcome_adapter.py', 'outcomes')
    table, saved, source = features.verify_source_seal(root, release['sourceRankingReceipt'])
    c.check(source['snapshot'] is False and source['plannedCount'] == 900 and source['evaluationRole'] == 'development'
            and table['origin'] == 'round4-frozen-generation-plan' and table['groupingBinding'] == release['grouping'], 'Wrong generation source scope')
    prep = features.prep_module(root)
    inventory, _ = prep.verify_preparation(root, source['preparationReceipt'])
    cohort, verified_plan, _, _, _ = prep.verify_cohort(root, inventory['cohort'])
    # verify_cohort returns a runtime-only digest field; require its authenticated
    # value and compare every serialized plan field without mutating either copy.
    c.check(verified_plan.get('_sha256') == release['generationPlan']['sha256']
            and {k: v for k, v in verified_plan.items() if k != '_sha256'} == plan
            and cohort['generationPlan'] == release['generationPlan'] and cohort['evaluationRole'] == 'development',
            'Generation cohort/plan differs')
    outcome, outcome_receipt = outcomes.verify_evaluation(root, release['outcomeReceipt'])
    c.check(outcome['evaluationRole'] == 'development' and outcome['cohort'] == inventory['cohort'], 'Generation outcome cohort differs')
    request = c.load(root, outcome_receipt['request'])
    c.check(request['sourceRankingReceipt'] == release['sourceRankingReceipt']
            and request['preparationReceipt'] == source['preparationReceipt'], 'Generation outcome source seal differs')
    labels = g.join_outcomes(table['rows'], inventory['rows'], outcome['rows'])
    timings = {}; timing_bindings = []
    for row in inventory['rows']:
        if row['generationReceipt'] is None:
            timings[row['id']] = None
        else:
            raw = c.load(root, row['generationReceipt'])
            c.check(raw['jobId'] == row['id'], 'Timing attempt differs')
            elapsed = raw.get('elapsedSeconds')
            c.check(raw.get('elapsed_seconds', elapsed) == elapsed, 'Timing aliases differ')
            timings[row['id']] = elapsed; timing_bindings.append(row['generationReceipt'])
    comparison = g.analyze(table['rows'], labels, saved['ranks'], grouping, plan, timings)
    documents = {'comparison.json': c.json_bytes(comparison), 'timing-bindings.json': c.json_bytes(timing_bindings),
                 'REPORT.md': g.render_report(comparison).encode()}
    c.replay_documents(root, receipt_binding, receipt, documents)
    return comparison, receipt

def choose(comparison, documents, model_bindings):
    """Pure policy decision on already authenticated frozen nested results."""
    arm = comparison['pairGenerationDecision']['selectedArm']
    c.check(arm in ('baseline', 'broader', 'msa1024'), 'Unknown selected generation arm')
    if arm != 'baseline':
        c.check(comparison['pairGenerationDecision']['candidates'][arm]['passes'] is True, 'Generation alternative did not pass its gate')
    assessments = {}
    for family in FAMILIES:
        nested = documents[family + '-nested.json']; model = documents[family + '-model.json']
        c.check(nested['family'] == model['family'] == family, 'Family identity differs')
        result = nested['learnerSupportedComparison']; candidate = nested['learnerSupported']; baseline = nested['learnerSupportedBaseline']
        cp = candidate['pools']; bp = baseline['pools']
        c.check(set(cp) == set(bp) and bool(cp), 'Supported pool membership differs')
        coverage = all(cp[p]['selectionAvailable'] is bp[p]['selectionAvailable'] for p in cp)
        losses = sorted(p for p in cp if cp[p]['firstAcceptableProbability'] is not None
                        and bp[p]['firstAcceptableProbability'] is not None
                        and cp[p]['firstAcceptableProbability'] < bp[p]['firstAcceptableProbability'])
        gain = result['firstDockQGain']
        c.check(gain is None or c.finite(gain), 'Nonfinite/Boolean nested gain')
        c.check(sorted(result['acceptableLossPools']) == losses, 'Nested acceptable-loss record differs')
        checks = {'usefulGain': gain is not None and gain >= .02, 'noAcceptableFirstLoss': not losses,
                  'selectionCoverageUnchanged': coverage and result['coverageUnchanged'] is True,
                  'fittedRidgeModel': model['kind'] == 'ridge'}
        c.check(model['kind'] in ('source', 'ridge'), 'Unexpected final model kind')
        assessments[family] = {'eligible': all(checks.values()), 'checks': checks, 'nestedPairFirstDockQGain': gain,
                               'acceptableLossPools': losses, 'supportedPlannedPools': len(cp),
                               'supportedSelectedPools': candidate['aggregate']['selectedPools'],
                               'finalModelKind': model['kind'], 'modelBinding': model_bindings[family]}
    eligible = [f for f in FAMILIES if assessments[f]['eligible']]
    chosen = max(eligible, key=lambda f: assessments[f]['nestedPairFirstDockQGain']) if eligible else 'source'
    return {'schema': 'confovhh-round4-final-selection-v1', 'status': 'COMPLETE_EXPLORATORY_SELECTION',
            'selectedFamily': chosen, 'selectedModel': None if chosen == 'source' else model_bindings[chosen],
            'pairGenerationArm': arm, 'otherContextsGenerationArm': 'baseline',
            'reservedPlannedAttempts': 75 if arm == 'baseline' else 100, 'familyAssessments': assessments,
            'tiePreference': list(FAMILIES), 'selectionEvidence': 'verified-combined-1200-nested-and-final-fit',
            'familyChoiceAfterOuterResultsIsExploratory': True, 'productionDefaultChanged': False,
            'generalSuperiorityClaim': False, 'reservedOutcomesUsed': False, 'modelsFitByReporter': 0,
            'finalPolicyAuthorized': False, 'generationAuthorized': False, 'outcomeOpeningAuthorized': False}

def incomplete_choice(comparison, status, reason):
    c.check(status['fitEligible'] is False and status['status'] == 'INCOMPLETE_GENERATED_OUTCOMES'
            and status['planned'] == 1200 and status['generatedOutcomesUnavailable'], 'Incomplete disposition requires an authenticated incomplete 1200 join')
    arm = comparison['pairGenerationDecision']['selectedArm']
    c.check(arm in ('baseline', 'broader', 'msa1024'), 'Unknown generation arm')
    if arm != 'baseline':
        c.check(comparison['pairGenerationDecision']['candidates'][arm]['passes'] is True, 'Incomplete disposition cannot authorize a failed generation alternative')
    missing = [{'id': ident, **status['newOutcomeDispositions'][ident]} for ident in status['generatedOutcomesUnavailable']]
    c.check(all(x['status'] == 'unavailable' and type(x['reason']) is str and x['reason'] for x in missing), 'Missing outcome explanation lost')
    return {'schema': 'confovhh-round4-incomplete-source-disposition-v1', 'status': 'SOURCE_BASELINE_PRESERVED_INCOMPLETE_DEVELOPMENT',
            'selectedFamily': 'source', 'selectedModel': None, 'pairGenerationArm': arm, 'otherContextsGenerationArm': 'baseline',
            'reservedPlannedAttempts': 75 if arm == 'baseline' else 100,
            'selectionEvidence': 'incomplete-development-parent-authorized-source-preservation', 'reason': reason,
            'generatedOutcomesUnavailable': missing, 'completedCombinedFit': False, 'sourceWonComparisonClaim': False,
            'productionDefaultChanged': False, 'generalSuperiorityClaim': False, 'reservedOutcomesUsed': False,
            'modelsFitByReporter': 0, 'finalPolicyAuthorized': False, 'generationAuthorized': False, 'outcomeOpeningAuthorized': False}

def authenticated_selection(root, release):
    incomplete = validate_release(root, release)
    comparison, generation = replay_generation(root, release['generationAnalysisReceipt'])
    join_module = c.dependency(root, 'round4-ranking/combine_development.py', 'join')
    joined = join_module.verify_combination(root, release['combinedJoinReceipt'])
    join_release = c.load(root, joined['joinRelease'])
    c.check(join_release['newSourceReceipt'] == generation['sourceRankingReceipt']
            and join_release['newOutcomeReceipt'] == generation['outcomeReceipt'], 'Generation comparison and combined fit used different new900 evidence')
    names = ('predictions.json', 'labels.json', 'join-status.json') + (('fit-release.proposed.json',) if joined['fitEligible'] else ())
    joined_files = c.output_files(root, release['combinedJoinReceipt'], joined['files'], names)
    status = c.load(root, joined_files['join-status.json'])
    if incomplete:
        return incomplete_choice(comparison, status, release['reason'])
    c.check(joined['fitEligible'] is True and joined['planned'] == 1200 and joined['status'] == 'READY_FOR_SEPARATE_FIT_RELEASE', 'Normal selection requires a complete combined1200 join')
    fit_path = c.bound(root, release['fitReceipt']); fit = c.load(root, release['fitReceipt'])
    c.exact(fit, ('schema', 'implementation', 'files', 'status', 'release', 'planned', 'reservedOutcomesRead'))
    c.check(fit['schema'] == 'confovhh-round4-ranking-execution-receipt-v1' and fit['status'] == 'COMPLETE'
            and type(fit['planned']) is int and fit['planned'] == 1200 and fit['reservedOutcomesRead'] is False, 'Complete development1200 fit required')
    fit_release = c.load(root, fit['release'])
    c.check(fit_release['predictionTable'] == joined_files['predictions.json'] and fit_release['labels'] == joined_files['labels.json'], 'Fit is not bound to the combined join')
    runner = c.dependency(root, 'round4-ranking/run.py', 'runner')
    runner.validate_release(root, fit_release)
    verifier = c.dependency(root, 'round4-ranking/verify_fit_independent_v2.py', 'fit_verifier')
    actual_verification = verifier.verify_fit(fit_path.parent)
    c.check(c.load(root, release['fitVerification']) == actual_verification, 'Independent fit verification differs from fresh arithmetic replay')
    c.check(actual_verification['fitReceipt'] == release['fitReceipt'] and actual_verification['planned'] == 1200, 'Fit verification belongs to another run')
    documents = {name: c.load(root, binding) for name, binding in fit['files'].items()}
    return choose(comparison, documents, {f: fit['files'][f + '-model.json'] for f in FAMILIES})

def render(selection):
    lines = ['# Frozen development selection', '',
             f"Operating candidate: **{selection['selectedFamily']}**. Pair generation setting: **{selection['pairGenerationArm']}**. Other assembly contexts retain baseline.", '',
             f"Reserved roster: {selection['reservedPlannedAttempts']} attempts, including the ADGRV1 alternative only when the development generation gate selects it.", '']
    if selection['schema'] == 'confovhh-round4-incomplete-source-disposition-v1':
        lines += ['The combined development study is incomplete. Source confidence is preserved by explicit parent disposition; this is not evidence that it won a completed model comparison.', '',
                  f"Reason: {selection['reason']}", f"Generated candidates with unavailable outcomes: {len(selection['generatedOutcomesUnavailable'])}. Every identity and reason remains in selection.json.", '']
    else:
        lines += ['Both fixed model families were assessed against the frozen useful-gain, acceptable-first-loss, coverage and final-ridge criteria.', '',
                  '| Family | Nested pair first-choice gain | Acceptable losses | Final model | Eligible |', '|---|---:|---:|---|---|']
        for family in FAMILIES:
            item = selection['familyAssessments'][family]; gain = item['nestedPairFirstDockQGain']
            lines.append(f"| {family} | {'unavailable' if gain is None else format(gain, '.6f')} | {len(item['acceptableLossPools'])} | {item['finalModelKind']} | {item['eligible']} |")
        lines += ['', 'Choosing a family after comparing outer validation results is exploratory selection. All 1,200 development attempts remain in the bound evidence.', '']
    lines += ['This record authorizes neither a final policy, generation nor outcome opening. No model was fitted by this reporter. One reserved learner-eligible group cannot establish general superiority or justify changing the production default.', '']
    return '\n'.join(lines)

def documents(selection):
    return {'selection.json': c.json_bytes(selection), 'REPORT.md': render(selection).encode()}

def receipt_metadata(release_binding, release, selection):
    incomplete = selection['schema'] == 'confovhh-round4-incomplete-source-disposition-v1'
    return {'schema': 'confovhh-round4-incomplete-selection-receipt-v1' if incomplete else 'confovhh-round4-final-selection-receipt-v1',
            'status': selection['status'], 'release': release_binding, 'reportingFreeze': release['reportingFreeze'],
            'generationAnalysisReceipt': release['generationAnalysisReceipt'], 'combinedJoinReceipt': release['combinedJoinReceipt'],
            'fitReceipt': None if incomplete else release['fitReceipt'], 'fitVerification': None if incomplete else release['fitVerification'],
            'selectedModel': selection['selectedModel'], 'modelsFit': 0, 'reservedOutcomesRead': False,
            'finalPolicyAuthorized': False, 'productionDefaultChanged': False}

def execute(root, release_path, output):
    rb = c.binding(root, release_path); release = c.load(root, rb)
    selection = authenticated_selection(root, release)
    return c.write_bundle(root, output, documents(selection), receipt_metadata(rb, release, selection))

def verify_selection(root, receipt_binding):
    receipt = c.load(root, receipt_binding)
    c.exact(receipt, ('schema', 'status', 'release', 'reportingFreeze', 'generationAnalysisReceipt', 'combinedJoinReceipt',
                     'fitReceipt', 'fitVerification', 'selectedModel', 'modelsFit', 'reservedOutcomesRead', 'finalPolicyAuthorized', 'productionDefaultChanged', 'files'))
    release = c.load(root, receipt['release']); selection = authenticated_selection(root, release)
    expected = receipt_metadata(receipt['release'], release, selection)
    c.check({k: v for k, v in receipt.items() if k != 'files'} == expected, 'Selection receipt did not replay')
    c.replay_documents(root, receipt_binding, receipt, documents(selection))
    return selection, receipt

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('select', 'verify')); parser.add_argument('--artifacts', type=Path, default=c.ROOT)
    parser.add_argument('--release', type=Path); parser.add_argument('--receipt', type=Path); parser.add_argument('--output', type=Path)
    args = parser.parse_args(); root = args.artifacts.resolve()
    if args.command == 'select':
        result = execute(root, args.release.resolve(), args.output.absolute())
    else:
        _, result = verify_selection(root, c.binding(root, args.receipt.absolute()))
    print({'status': result['status'], 'modelsFit': 0, 'finalPolicyAuthorized': False})

if __name__ == '__main__':
    main()
