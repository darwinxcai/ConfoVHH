"""Descriptive figures from completed, receipt-bound reports; no decisions."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

os.environ['MPLCONFIGDIR'] = str(Path(tempfile.gettempdir()) / 'confovhh-round4-mpl')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[2]
ARMS = ('baseline', 'broader', 'msa1024')
COLORS = {'baseline': '#4d6172', 'broader': '#c77421', 'msa1024': '#167f84'}
ARM_LABELS = {'baseline': 'Baseline', 'broader': 'Broader sampling', 'msa1024': 'Alignment subsampling'}
ORDER = ['dev_8qot', 'dev_6knm', 'dev_8th3', 'dev_8th4', 'RHO_NB2',
         'HCRTR2_SB51', 'ADRA1A_NB29', 'FZD3_NB9', 'LGR4_NB21',
         'CHRM1_NB1B4', 'GRM5_NB43', 'CASR_NB2D11']
LABELS = {'dev_8qot': 'OPRM1 / NbE', 'dev_6knm': 'APLNR / JN241',
          'dev_8th3': 'AGTR1 / AT118 (8TH3)', 'dev_8th4': 'AGTR1 / AT118 (8TH4)',
          'RHO_NB2': 'RHO / Nb2', 'HCRTR2_SB51': 'HCRTR2 / Sb51',
          'ADRA1A_NB29': 'ADRA1A / Nb29', 'FZD3_NB9': 'FZD3 / Nb9',
          'LGR4_NB21': 'LGR4 / Nb21', 'CHRM1_NB1B4': 'CHRM1 / Nb1B4 + helix',
          'GRM5_NB43': 'GRM5 / Nb43 dimer', 'CASR_NB2D11': 'CASR / Nb2D11 dimer',
          'ADGRV1_RE02': 'ADGRV1 / RE02', 'GPR158_NB20': 'GPR158 / Nb20 dimer',
          'MC4R_PN162': 'MC4R / pN162 full assembly'}


def need(value, message):
    if not value:
        raise ValueError(message)


def binding(path):
    path = path.resolve()
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest()}


def report_member(receipt_path, expected_schema, name):
    need(receipt_path.resolve().is_relative_to(ROOT), 'Receipt outside execution root')
    receipt = json.loads(receipt_path.read_text())
    need(receipt['schema'] == expected_schema, 'Wrong report receipt')
    members = [x for x in receipt['files'] if Path(x['path']).name == name]
    need(len(members) == 1, 'Missing or ambiguous report member')
    bound = members[0]
    rel = Path(bound['path'])
    need(not rel.is_absolute() and '..' not in rel.parts, 'Unsafe report path')
    path = ROOT / rel
    need(path.resolve() == path and not path.is_symlink(), 'Indirect report member')
    need(binding(path) == bound, 'Report member identity changed')
    return json.loads(path.read_text()), bound, receipt


def checked_q(value):
    need(value is None or (type(value) in (int, float) and math.isfinite(value)
                           and 0 <= value <= 1), 'Invalid structural quality')
    return value


def axes_pair(height):
    fig, (ax, counts) = plt.subplots(1, 2, figsize=(12.5, height),
                                    gridspec_kw={'width_ratios': [4.6, 1.5]}, sharey=True)
    ax.set_xlim(-.025, 1.025)
    ax.set_xticks([0, .2, .4, .6, .8, 1])
    ax.axvline(.23, color='#9a8b73', ls=':', lw=1)
    ax.grid(axis='x', color='#e9edf0')
    ax.set_axisbelow(True)
    ax.set_xlabel('Structural agreement with the reference (DockQ; higher is better)')
    counts.set_xlim(0, 1)
    counts.set_xticks([])
    counts.tick_params(axis='y', left=False, labelleft=False)
    for spine in counts.spines.values():
        spine.set_visible(False)
    return fig, ax, counts


def point(ax, y, first, best, color):
    first, best = checked_q(first), checked_q(best)
    if first is not None and best is not None:
        ax.plot([first, best], [y, y], lw=1.1, alpha=.5, color=color)
    if best is not None:
        ax.scatter(best, y, marker='|', s=150, color=color, zorder=3)
    if first is not None:
        ax.scatter(first, y, s=32, color=color, zorder=4)
    else:
        ax.text(.008, y, 'selection unavailable', va='center', fontsize=7, color=color)


def draw_generation(data):
    need(data['schema'] == 'confovhh-round4-generation-comparison-v1'
         and data['plannedAttempts'] == 900 and data['old300Included'] is False,
         'Only completed new900 generation comparison may be plotted')
    pools = {(p['setId'], p['generationArm']): p for p in data['pools']}
    need(set(pools) == {(t, a) for t in ORDER for a in ARMS}, 'Incomplete generation pool membership')
    fig, ax, counts = axes_pair(11.5)
    for row, target in enumerate(ORDER):
        if row >= 9:
            for axis in (ax, counts):
                axis.axhspan(row-.48, row+.48, color='#f1f3f5', zorder=0)
        for offset, arm in zip((-.23, 0, .23), ARMS):
            p = pools[target, arm]
            need(p['plannedCount'] == 25, 'Unexpected candidate count')
            y = row + offset
            point(ax, y, p['firstDockQ'], p['bestAvailableDockQ'], COLORS[arm])
            suffix = '*' if p['unavailableOutcomeCount'] else ''
            counts.text(.12, y, f"{p['knownAcceptableCount']}/{p['plannedCount']}{suffix}",
                        color=COLORS[arm], va='center', fontsize=9)
            counts.text(.63, y, f"{p['evaluableCount']}/{p['plannedCount']}",
                        color=COLORS[arm], va='center', fontsize=9)
    ax.set_yticks(range(len(ORDER)), [LABELS[t] for t in ORDER])
    ax.set_ylim(len(ORDER)-.45, -.7)
    ax.set_title('First confidence choice and best available candidate', loc='left', fontsize=11)
    counts.set_title('Acceptable     Evaluated', loc='left', fontsize=10)
    handles = [Line2D([0], [0], color=COLORS[a], marker='o', lw=1,
                      label=ARM_LABELS[a]) for a in ARMS]
    fig.legend(handles=handles, loc='lower left', bbox_to_anchor=(.015, .073),
               ncol=3, frameon=False, fontsize=9)
    fig.suptitle('ConfoVHH · 900 new predictions', x=.02, y=.985, ha='left', fontsize=19, fontweight='bold')
    fig.text(.02, .949, '25 fixed attempts per setting and case. Each dot is the first confidence choice; each tick is the best evaluated candidate.', fontsize=9)
    fig.text(.02, .015,
             'Acceptable = DockQ ≥ 0.23. Shaded cases have additional assembly context and do not choose the pair-generation setting.\n'
             'The nine pair cases represent eight biological groups; the two AGTR1 cases share group weight. CASR is exploratory.\n'
             '* Unavailable outcomes make the acceptable count a lower bound. Missing results are not zero-filled. This is development evidence.',
             fontsize=8, color='#535e68')
    fig.tight_layout(rect=(.01, .115, .99, .92))
    return fig


def draw_reserved(data):
    need(data['schema'] == 'confovhh-round4-reserved-summary-v1'
         and data['allPlannedAttemptsRetained'] is True, 'Wrong reserved summary')
    targets = ('ADGRV1_RE02', 'GPR158_NB20', 'MC4R_PN162')
    keys = [(t, a) for t in targets for a in ARMS
            if any(p['setId'] == t and p['generationArm'] == a for p in data['pools'])]
    need(len(keys) in (3, 4), 'Unexpected reserved panel')
    policies = data['policies']
    need(policies in (['source'], ['source', 'challenger']), 'Unexpected reserved policy roster')
    pools = {(p['setId'], p['generationArm'], p['policy']): p for p in data['pools']}
    fig, ax, counts = axes_pair(6.0 if len(keys) == 3 else 6.7)
    for row, (target, arm) in enumerate(keys):
        if target != 'ADGRV1_RE02':
            for axis in (ax, counts):
                axis.axhspan(row-.45, row+.45, color='#f1f3f5', zorder=0)
        for index, policy in enumerate(policies):
            p = pools[target, arm, policy]
            y = row if len(policies) == 1 else row + (-.11 if index == 0 else .11)
            point(ax, y, p['firstDockQ'], p['bestAvailableDockQ'],
                  '#4d6172' if policy == 'source' else '#167f84')
        p = pools[target, arm, 'source']
        suffix = '*' if p['unavailableOutcomeCount'] else ''
        counts.text(.1, row, f"{p['knownAcceptableCount']}/{p['plannedCount']}{suffix}", va='center', fontsize=10)
        counts.text(.62, row, f"{p['evaluableCount']}/{p['plannedCount']}", va='center', fontsize=10)
    labels = [LABELS[t] + '\n' + ARM_LABELS[a] for t, a in keys]
    ax.set_yticks(range(len(keys)), labels)
    ax.set_ylim(len(keys)-.4, -.6)
    ax.set_title('First choice and best available candidate', loc='left', fontsize=11)
    counts.set_title('Acceptable     Evaluated', loc='left', fontsize=10)
    handles = [Line2D([0], [0], color='#4d6172', marker='o', lw=1, label='Predictor confidence')]
    if 'challenger' in policies:
        handles.append(Line2D([0], [0], color='#167f84', marker='o', lw=1, label='Frozen learned selector'))
    fig.legend(handles=handles, loc='lower left', bbox_to_anchor=(.015, .105), ncol=2, frameon=False, fontsize=9)
    fig.suptitle(f"ConfoVHH · {data['counts']['planned']} reserved attempts", x=.02, y=.985,
                 ha='left', fontsize=19, fontweight='bold')
    fig.text(.02, .91, 'Selection and generation rules were frozen before these predictions. Each tick marks the best evaluated candidate.', fontsize=9)
    fig.text(.02, .015,
             'ADGRV1 is the only learner-eligible group. Shaded cases test source/fallback coverage in full assemblies.\n'
             'Acceptable = DockQ ≥ 0.23. * denotes a lower bound when outcomes are unavailable. No population interval for one group.\n'
             'Cases have prior metadata/source exposure and uncertain predictor-training membership; no general superiority claim.',
             fontsize=8, color='#535e68')
    fig.tight_layout(rect=(.01, .175, .99, .865))
    return fig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generation-receipt', required=True, type=Path)
    parser.add_argument('--reserved-receipt', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    need(output.is_relative_to(Path(__file__).resolve().parent) and not output.exists(),
         'New output directory under figures required')
    generation, gb, gr = report_member(args.generation_receipt,
        'confovhh-round4-generation-analysis-receipt-v1', 'comparison.json')
    reserved, rb, rr = report_member(args.reserved_receipt,
        'confovhh-round4-reserved-summary-receipt-v1', 'summary.json')
    need(gr['status'] == 'COMPLETE' and rr['status'] in
         ('COMPLETE_DESCRIPTIVE_SUMMARY', 'NEEDS_ATTENTION'), 'Unfinished reports')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                         'axes.spines.top': False, 'axes.spines.right': False})
    figures = [('generation-comparison', draw_generation(generation)),
               ('reserved-results', draw_reserved(reserved))]
    output.mkdir()
    files = []
    for name, figure in figures:
        for suffix in ('png', 'svg', 'pdf'):
            path = output / (name + '.' + suffix)
            figure.savefig(path, dpi=180, bbox_inches='tight')
            files.append(binding(path))
        plt.close(figure)
    receipt = {'schema': 'confovhh-round4-descriptive-figures-v1',
               'reportReceipts': [binding(args.generation_receipt), binding(args.reserved_receipt)],
               'reportMembers': [gb, rb], 'implementation': binding(Path(__file__)),
               'matplotlibVersion': matplotlib.__version__, 'files': files,
               'rankingOrSelectionChanged': False, 'outcomesRecomputed': False,
               'structuralQualityValuesUnchanged': True, 'missingValuesZeroFilled': False}
    with (output / 'receipt.json').open('x') as stream:
        json.dump(receipt, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'COMPLETE', 'figures': len(figures), 'files': len(files)}))


if __name__ == '__main__':
    main()
