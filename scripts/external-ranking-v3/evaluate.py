"""Pure v3 evaluation helpers; callers authenticate inputs before joining labels.

This module performs no file IO, scoring, calibration or candidate filtering.
Eligibility comes from the saved policy and is reported beside full attempt
coverage. Outcomes may be absent; missing probability mass is never dropped.
"""
from __future__ import annotations
import math

THRESHOLDS = (.23, .49, .80)


def check(ok, message):
    if not ok:
        raise ValueError(message)


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def verify_rank_record(record, planned_ids):
    check(len(planned_ids) == len(set(planned_ids)) and len(planned_ids) > 0, 'Invalid planned inventory')
    rows = record['rows']
    check(len(rows) == len(planned_ids) and {r['id'] for r in rows} == set(planned_ids), 'Saved policy row membership differs')
    for row in rows:
        check(type(row['eligible']) is bool, 'Invalid eligibility flag')
        check(row['status'] in ('scored', 'unavailable', 'excluded'), 'Invalid saved row status')
        check(row['validityStatus'] in ('valid', 'invalid', 'not-produced'), 'Invalid validity state')
        check(row['sourceStatus'] in ('present', 'missing', 'invalid', 'not-produced'), 'Invalid source state')
        check(row['interfaceStatus'] in ('contacting', 'no-contact', 'unavailable', 'invalid-input', 'not-produced'), 'Invalid interface state')
        check((row['sourceStatus'] == 'not-produced') == (row['validityStatus'] == 'not-produced'), 'Producer and validity states differ')
        expected_interfaces = {'valid':('contacting', 'no-contact', 'unavailable'), 'invalid':('invalid-input',), 'not-produced':('not-produced',)}
        check(row['interfaceStatus'] in expected_interfaces[row['validityStatus']], 'Interface and validity states differ')
        if row['key'] is not None:
            check(row['eligible'] and row['sourceStatus'] == 'present' and row['status'] == 'scored', 'Scored row is not eligible/source available')
            check(isinstance(row['key'], list) and len(row['key']) in (1, 3) and all(v is None or finite(v) for v in row['key']) and row['key'][0] is not None, 'Invalid scientific key')
            check(type(row['rank']) is int and row['rank'] > 0, 'Invalid scientific rank')
        else:
            check(row['rank'] is None and row['status'] == ('unavailable' if row['eligible'] else 'excluded'), 'Missing/excluded row has an inconsistent rank')
            if row['eligible']:
                check(row['sourceStatus'] != 'present', 'Eligible present source lacks a rank')
    def sortable(key):
        return tuple((0, 0) if value is None else (1, value) for value in key)
    ordered = sorted((r for r in rows if r['key'] is not None), key=lambda r:sortable(r['key']), reverse=True)
    rank, previous = 0, None
    for row in ordered:
        if previous is None or row['key'] != previous:
            rank += 1
        check(row['rank'] == rank, 'Rank/tie differs from saved scientific key')
        previous = row['key']
    eligible = [r for r in rows if r['eligible']]
    produced = [r for r in rows if r['sourceStatus'] != 'not-produced']
    missing_source = [r for r in eligible if r['key'] is None]
    available = bool(eligible) and not missing_source
    check(record['status'] == ('ranked' if available else 'abstain'), 'Selection availability differs from eligibility/source completeness')
    selected = sorted(r['id'] for r in ordered if r['rank'] == 1) if available else []
    check(record['selected'] == selected, 'Selected scientific tie differs')
    coverage = {'plannedCount':len(rows), 'producedCount':len(produced), 'eligibleCount':len(eligible),
                'excludedCount':len(rows)-len(eligible), 'sourceRankedCount':len(ordered), 'missingSourceCount':len(missing_source)}
    check(isinstance(record['coverage'],dict) and all(type(v) is int and v >= 0 for v in record['coverage'].values()), 'Invalid coverage scalar, including booleans')
    check(record['coverage'] == coverage, 'Saved coverage differs from all planned rows')
    validity_applied = record['selectionPolicy']['validityApplied']
    check(type(validity_applied) is bool, 'Invalid validity policy flag')
    for row in rows:
        expected = row['sourceStatus'] != 'not-produced' and (not validity_applied or row['validityStatus'] == 'valid')
        check(row['eligible'] == expected, 'Eligibility differs from declared source/validity policy')
    return rows, eligible, produced, available


def weighted_summary(weights, outcomes):
    size = sum(weights.values())
    known = {id_:weight for id_,weight in weights.items() if outcomes.get(id_) is not None}
    known_mass = sum(known.values())
    missing = size-known_mass
    total = sum(weight*outcomes[id_] for id_,weight in known.items())
    complete = missing < 1e-12
    counts = {str(t):sum(weight for id_,weight in known.items() if outcomes[id_] >= t) for t in THRESHOLDS}
    return {'size':size, 'knownOutcomeMass':known_mass, 'missingOutcomeMass':missing, 'complete':complete,
            'meanDockQ':total/size if complete and size else None,
            'meanDockQBounds':[total/size, (total+missing)/size] if size else None,
            'correctCountsByThreshold':counts if complete else None,
            'correctFractionsByThreshold':{t:n/size for t,n in counts.items()} if complete and size else None,
            'correctCountBoundsByThreshold':{t:[n,n+missing] for t,n in counts.items()}, 'weights':weights}


def window_weights(rows, k):
    result = {}
    for row in rows:
        better = sum(other['rank'] < row['rank'] for other in rows)
        tied = sum(other['rank'] == row['rank'] for other in rows)
        weight = min(max(k-better, 0), tied)/tied
        if weight:
            result[row['id']] = weight
    return result


def average_ranks(values):
    return [1 + sum(other < value for other in values) + .5*(sum(other == value for other in values)-1) for value in values]


def correlation(a, b):
    if len(a) < 2:
        return None
    av, bv = sum(a)/len(a), sum(b)/len(b)
    x, y = [v-av for v in a], [v-bv for v in b]
    scale = math.sqrt(sum(v*v for v in x)*sum(v*v for v in y))
    return sum(v*w for v,w in zip(x,y))/scale if scale else None


def evaluate_record(record, outcomes, planned_ids):
    """Evaluate one saved set/arm, preserving its full and eligible denominators.

    `outcomes` maps IDs to DockQ numbers or None. A larger multi-set mapping is
    allowed; this function uses exactly `planned_ids`. The caller must verify
    score receipts, coordinate hashes, reference identity and outcome provenance.
    """
    rows, eligible, produced, selection_available = verify_rank_record(record, planned_ids)
    values = {id_:outcomes.get(id_) for id_ in planned_ids}
    check(all(v is None or finite(v) and 0 <= v <= 1 for v in values.values()), 'Invalid outcome scalar, including boolean/nonfinite values')
    valid = [r for r in produced if r['validityStatus'] == 'valid']
    selected = record['selected']
    selection = weighted_summary({id_:1/len(selected) for id_ in selected}, values) if selected else None
    windows = {f'top{k}':weighted_summary(window_weights(eligible, min(k,len(eligible))),values) for k in (1,5,10)} if selection_available else None
    rank_complete = selection_available and all(values[r['id']] is not None for r in eligible)
    metric = {'scope':'Only explicitly policy-eligible rows; never described as a full-planned-pool ordering',
              'complete':rank_complete, 'spearmanPreferenceVsDockQ':None, 'pairwiseAUROCByThreshold':None,
              'undefinedReason':'Selection unavailable or at least one eligible outcome missing' if not rank_complete else ''}
    if rank_complete:
        quality = [values[r['id']] for r in eligible]
        ranks = [r['rank'] for r in eligible]
        corr = correlation(average_ranks(ranks),average_ranks(quality))
        metric['spearmanPreferenceVsDockQ'] = -corr if corr is not None else None
        auc = {}
        for t in THRESHOLDS:
            pos = [r for r,q in zip(ranks,quality) if q >= t]
            neg = [r for r,q in zip(ranks,quality) if q < t]
            auc[str(t)] = sum(1 if p < n else .5 if p == n else 0 for p in pos for n in neg)/(len(pos)*len(neg)) if pos and neg else None
        metric['pairwiseAUROCByThreshold'] = auc
        metric['undefinedReason'] = 'Some metrics are undefined for constant ranks/quality or one-class thresholds' if corr is None or any(v is None for v in auc.values()) else ''
    interface_state = 'no-valid-inputs' if not valid else 'unsupported-all-no-contact' if all(r['interfaceStatus'] == 'no-contact' for r in valid) else 'contacting-candidates-present' if any(r['interfaceStatus'] == 'contacting' for r in valid) else 'unavailable'
    by_id = {r['id']:r for r in rows}
    selected_states = {state:sum(by_id[id_]['interfaceStatus'] == state for id_ in selected)/len(selected) for state in ('contacting','no-contact','unavailable','invalid-input','not-produced')} if selected else None
    return {'setId':record['setId'], 'arm':record['arm'], 'status':record['status'], 'reason':record['reason'],
            'coverage':{**record['coverage'], 'validInputCount':len(valid), 'invalidInputCount':sum(r['validityStatus'] == 'invalid' for r in produced),
                        'notProducedCount':len(rows)-len(produced), 'selectionAvailable':selection_available,
                        'eligibleFractionOfProduced':len(eligible)/len(produced) if produced else None},
            'missingOutcomeIdsAllPlanned':[id_ for id_ in planned_ids if values[id_] is None],
            'missingOutcomeIdsEligible':[r['id'] for r in eligible if values[r['id']] is None],
            'pools':{'allPlanned':weighted_summary({r['id']:1 for r in rows},values),
                     'allProduced':weighted_summary({r['id']:1 for r in produced},values),
                     'allValidInputs':weighted_summary({r['id']:1 for r in valid},values),
                     'policyEligible':weighted_summary({r['id']:1 for r in eligible},values)},
            'selected':{'ids':selected, 'available':selection_available, 'summary':selection}, 'practicalWindows':windows,
            'firstChoiceDockQ':selection['meanDockQ'] if selection else None,
            'firstChoiceAcceptableProbability':selection['correctFractionsByThreshold']['0.23'] if selection and selection['correctFractionsByThreshold'] else None,
            'eligibleRankingMetrics':metric,
            'interfaceSupport':{'status':interface_state, 'selectedStateProbabilities':selected_states,
                                'interpretation':'Contact presence and numeric selection availability do not establish a correct binding interface'},
            'validationScope':'Pure numeric helper only; caller authenticates score, coordinate, reference and outcome identities; no labels are used to recompute eligibility, features or ranks'}


def aggregate_groups(evaluations, membership):
    """Equal biological-group weight; equal sets within groups; preserve missing."""
    by_key = {(r['setId'],r['arm']):r for r in evaluations}
    check(len(by_key) == len(evaluations), 'Duplicate evaluation set/arm')
    check({r['setId'] for r in evaluations} == set(membership), 'Biological group membership differs')
    groups = {}
    for set_id, group in membership.items():
        groups.setdefault(group,[]).append(set_id)
    fields = ('firstChoiceDockQ','firstChoiceAcceptableProbability')
    result = []
    for arm in sorted({r['arm'] for r in evaluations}):
        group_rows = []
        for group, sets in sorted(groups.items()):
            check(all((s,arm) in by_key for s in sets), 'Missing planned evaluation arm')
            means = {field:None if any(by_key[s,arm][field] is None for s in sets) else sum(by_key[s,arm][field] for s in sets)/len(sets) for field in fields}
            group_rows.append({'group':group, 'sets':sorted(sets), 'means':means,
                               'selectionAvailableSets':sum(by_key[s,arm]['coverage']['selectionAvailable'] for s in sets), 'plannedSets':len(sets)})
        result.append({'arm':arm, 'groups':group_rows, 'equalGroupMeans':{field:None if any(g['means'][field] is None for g in group_rows) else sum(g['means'][field] for g in group_rows)/len(group_rows) for field in fields},
                       'policy':'No missing or abstaining set/group is removed from a macro mean'})
    return result
