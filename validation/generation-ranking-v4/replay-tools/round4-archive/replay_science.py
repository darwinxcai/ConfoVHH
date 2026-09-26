"""Replay archived evidence only after final root authorization; no DockQ rerun."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys
import archive_common as c

sys.dont_write_bytecode = True


def replay_capture(root, cap):
    helper = c.module(root/'round4-reserved-preparation/v2/capture_inputs.py', 'archive_reserved_capture')
    bundle = root/cap['bundleRoot']; output = root/cap['outputRoot']
    plan = helper.validate_bundle(bundle)
    receipts = [helper.verify_receipt(bundle, output, plan, t) for t in plan['targets']]
    complete = c.load(c.bound(root, cap['completeReceipt']))
    c.check(complete['schema'] == 'confovhh-round4-reserved-capture-complete-v1' and complete['status'] == 'PASS' and
            complete['receipts'] == receipts and complete['planSha256'] == c.sha(bundle/'capture-plan.json') and
            complete['molecularPredictionsRun'] == 0, 'Reserved capture does not replay')
    return {'targets': len(receipts), 'exactQueriesAndFullContextsVerified': True, 'noTemplatesOrRestraints': True,
            'zeroInputCoordinatesVerified': True, 'networkUsed': False, 'predictionsGenerated': False}


def replay_fit(root, item, count, fit_module):
    path = c.bound(root, item['fitReceipt']); expected = c.load(c.bound(root, item['independentFitReceipt']))
    actual = fit_module.verify_fit(path.parent)
    fit_module.same(expected, actual)
    c.check(actual['status'] == 'PASS' and actual['planned'] == count and actual['fitReceipt'] == item['fitReceipt'], 'Independent fit denominator/identity differs')
    return {'planned': count, 'independentSavedFitRecalculated': True,
            'uniqueInnerModelsChecked': actual['uniqueInnerModelsChecked'], 'allSavedAuditFieldsMatch': True}


def replay(root):
    root = root.resolve(); manifest = c.load(c.regular(root, c.MANIFEST_NAME))
    m = c.load(c.bound(root, manifest['finalArtifactMap'], manifest['files']))
    c.validate_final_map(root, m, manifest['files']); c.phase_receipts(root, m, manifest['files'])
    for folder in ('round4-ranking', 'round4-outcomes', 'round4-reporting'):
        sys.path.insert(0, str(root/folder))
    features = c.module(root/'round4-ranking/prepare_features.py', 'archive_source_features')
    outcomes = c.module(root/'round4-outcomes/outcome_adapter.py', 'archive_outcomes')
    combined = c.module(root/'round4-ranking/combine_development.py', 'archive_combined_join')
    fit = c.module(root/'round4-ranking/verify_fit_independent_v2.py', 'archive_independent_fit')
    selection_api = c.module(root/'round4-reporting/select_final.py', 'archive_final_selection')
    summary_api = c.module(root/'round4-reporting/summarize_reserved.py', 'archive_reserved_summary')
    cohorts = {}
    for role in ('development', 'reserved'):
        row = m[role]; table, ranks, source = features.verify_source_seal(root, row['sourceRankingReceipt'])
        outcome, receipt = outcomes.verify_evaluation(root, row['outcomeReceipt'])
        c.check(source['snapshot'] is False and source['plannedCount'] == receipt['plannedCount'] == row['planned'], 'Final cohort count differs')
        c.check(outcome['cohort'] == row['cohort'] and len(table['rows']) == row['planned'], 'Cohort binding differs')
        request = c.load(c.bound(root, receipt['request']))
        c.check(request['sourceRankingReceipt'] == row['sourceRankingReceipt'], 'Outcome uses different source seal')
        cohorts[role] = {'planned': row['planned'], 'produced': source['producedCount'],
            'evaluated': receipt['evaluatedCount'], 'unavailable': receipt['unavailableCount'],
            'rawAndCanonicalInputsVerified': True, 'sourceContactFeaturesAndRanksRecomputed': True,
            'fixedCorrespondenceRecomputed': True, 'savedMetricViewAggregationRecomputed': True,
            'numericalDockQRecomputed': False}
    join = combined.verify_combination(root, m['combinedDevelopment']['joinReceipt'])
    c.check(join['planned'] == 1200, 'Combined denominator differs')
    initial = replay_fit(root, m['initialDevelopment'], 300, fit)
    if m['combinedDevelopment']['status'] == 'COMPLETE_FIT':
        c.check(join['fitEligible'] is True, 'Incomplete data cannot replay a completed fit')
        joined = replay_fit(root, m['combinedDevelopment'], 1200, fit)
    else:
        c.check(join['fitEligible'] is False and join['status'] == 'INCOMPLETE_GENERATED_OUTCOMES', 'False incomplete disposition')
        joined = {'planned': 1200, 'status': 'INCOMPLETE_GENERATED_OUTCOMES', 'modelsFit': False,
                  'missingAttemptsPreserved': True, 'fitCompletionClaimed': False}
    # These reporting APIs independently replay generation-comparison arithmetic,
    # final selection and reserved summaries from authenticated sources. They
    # never invoke a new DockQ calculation or refit a changed model.
    selection, selection_receipt = selection_api.verify_selection(root, m['reporting']['selectionReceipt'])
    summary, summary_receipt = summary_api.verify_reserved_summary(root, m['reporting']['reservedSummaryReceipt'])
    capture = replay_capture(root, m['reservedCapture'])
    return {'schema': 'confovhh-round4-extracted-scientific-replay-v1', 'status': 'PASS',
        'finalArtifactMap': manifest['finalArtifactMap'], 'cohorts': cohorts, 'initialDevelopmentFit': initial,
        'combinedDevelopment': joined, 'reservedCapture': capture,
        'reporting': {'selectionReceipt': m['reporting']['selectionReceipt'], 'reservedSummaryReceipt': m['reporting']['reservedSummaryReceipt'],
            'generationComparisonRecomputed': True, 'selectionRecomputed': True, 'reservedSummaryRecomputed': True},
        'numericalDockQRecomputed': False, 'numericalDockQScope': 'Saved production values authenticated; fixed sequence correspondence and all-view metric aggregation are recomputed, not calc_DockQ.',
        'independentGeneralizationEstablished': False, 'productionPromotion': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); root = c.ROOT.resolve(); output = args.output.resolve()
    c.check(output.parent == root and not output.exists(), 'Replay output must be new and outside selected scientific trees')
    result = replay(root)
    with output.open('xb') as f: f.write(c.packed(result))
    print(c.packed({'status': result['status'], 'numericalDockQRecomputed': False}).decode(), end='')
