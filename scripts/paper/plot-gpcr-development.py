#!/usr/bin/env python3
"""Plot every measured paired CSV row. No illustrative or imputed observations."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    csv_path = args.results / "paired-model-metrics.csv"
    summary = json.loads((args.results / "summary.json").read_text())
    if sha256(csv_path) != summary["outputs_sha256"][csv_path.name]:
        raise ValueError("Measured CSV changed after the reconciled summary")
    with csv_path.open() as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 165 or len({(r["job"], r["model"]) for r in rows}) != 165:
        raise ValueError("Expected all 165 unique measured pairs")
    references = ["3P0G", "5JQH", "4MQS", "5C1M"]
    if {r["reference"] for r in rows} != set(references):
        raise ValueError("Reference cohort changed")
    styles = {"supported": ("#168272", "o"), "mixed": ("#bc7919", "s"),
              "limited": ("#8d4d88", "^"), "not-assessable": ("#64748b", "x")}
    if not {r["confovhh_evidence_level"] for r in rows} <= set(styles):
        raise ValueError("Unknown ConfoVHH evidence level")
    args.out.mkdir(parents=True, exist_ok=False)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.hashsalt": "confovhh-gpcr-development-2026-09-05"})
    fig, axes = plt.subplots(2, 2, figsize=(9.0, 7.4), sharex=True, sharey=True)
    count = 0
    for ax, ref in zip(axes.flat, references, strict=True):
        group = [r for r in rows if r["reference"] == ref]
        for label, (color, marker) in styles.items():
            selected = [r for r in group if r["confovhh_evidence_level"] == label]
            ax.scatter([float(r["interface_burial_A2"]) for r in selected],
                       [float(r["official_DockQ"]) for r in selected],
                       c=color, marker=marker, s=31, alpha=.8, linewidths=.4)
            count += len(selected)
        ax.axhline(.23, color="#8b8b8b", ls="--", lw=.8, zorder=0)
        ax.set_title(f"{ref}  |  {len(group)} models / {len({r['job'] for r in group})} jobs", loc="left", fontsize=11)
        ax.set_ylim(-.025, 1.025)
        ax.set_xlim(left=0)
        ax.grid(axis="y", color="#e8eaed", lw=.6)
    if count != len(rows):
        raise ValueError("Plot omitted or duplicated measured rows")
    for ax in axes[:, 0]:
        ax.set_ylabel("Official DockQ 2.1.3")
    for ax in axes[1, :]:
        ax.set_xlabel("ConfoVHH interface burial (½ ΔSASA, Å²)")
    used = {r["confovhh_evidence_level"] for r in rows}
    handles = [Line2D([], [], color=color, marker=marker, linestyle="", markersize=6, label=label.capitalize())
               for label, (color, marker) in styles.items() if label in used]
    handles.append(Line2D([], [], color="#8b8b8b", ls="--", lw=.8, label="DockQ = 0.23"))
    fig.legend(handles=handles, loc="upper center", bbox_to_anchor=(.5, .927), ncol=len(handles), frameon=False)
    fig.suptitle("ConfoVHH geometry and native-interface recovery", x=.08, ha="left", y=.986, fontsize=15, weight="bold")
    fig.text(.08, .944, "165 retained models · 33 five-model jobs · 4 reference complexes · 3 receptor targets", fontsize=10, color="#4b5563")
    fig.text(.08, .025, "Retrospective development data; samples are nested within jobs and targets.\nNo full PAE supplied. Evidence levels describe structural triage, not probability of a correct native pose.", fontsize=9, color="#4b5563", linespacing=1.5)
    fig.subplots_adjust(left=.085, right=.975, bottom=.13, top=.855, hspace=.28, wspace=.14)
    stem = args.out / "confovhh-native-interface-recovery"
    fig.savefig(stem.with_suffix(".png"), dpi=200)
    fig.savefig(stem.with_suffix(".pdf"), metadata={"CreationDate": None, "ModDate": None})
    fig.savefig(stem.with_suffix(".svg"), metadata={"Date": None})
    plt.close(fig)
    receipt = {"status": "COMPLETE", "source_csv_sha256": sha256(csv_path),
               "script_sha256": sha256(Path(__file__)), "matplotlib_version": matplotlib.__version__,
               "input_rows": len(rows), "plotted_observations": count, "aggregation": "none",
               "imputed_or_illustrative_observations": 0,
               "outputs_sha256": {p.name: sha256(p) for p in sorted(args.out.iterdir())}}
    (args.out / "figure-provenance.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"FIGURE BUILD OK: {count} measured observations")


if __name__ == "__main__":
    main()
