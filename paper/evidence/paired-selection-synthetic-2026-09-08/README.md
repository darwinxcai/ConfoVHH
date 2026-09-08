# Synthetic paired-selection execution

These labels, method ranks, baseline ranks and policy-hash declarations are
arbitrary arithmetic controls. They are not GPCR predictions, ConfoVHH outputs,
native references, experimental outcomes, or independent benchmark groups.

`input.json` contains 12 eligible attempts and one explicitly retained failure,
three targets, two generators and two declared groups. The first group has target
differences +1 and 0; the second has difference -1. The equal-group contrast is
therefore `(mean(1, 0) + (-1)) / 2 = -0.25`, even though pooling the three
targets would give zero. This catches an important weighting error.

`receipt.json` records a successful execution, the exact input/evaluator/strict
parser hashes, Node runtime, complete stratum/group accounting, and the
conditional 95% bootstrap interval [-1, 0.75]. All scientific claim flags are
false. The interval is a synthetic calculation, not an estimate of this
software's accuracy. Symbolic repeated-digit policy hashes certify nothing.

Replay instructions and the authorization boundary are in
[PAIRED_SELECTION_EVALUATION.md](../../PAIRED_SELECTION_EVALUATION.md).
