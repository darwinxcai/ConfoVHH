# Source-first ranking: finite round3 experiment

Read [the result report](REPORT.md) and [the exact replay requirements](REPLAY.md).
This draft contains experimental scoring code, the prespecified design, compact
results and verification receipts. It does not change production defaults.

The complete local evidence archive is identified by SHA256 in
`evidence/round3-archive-receipt.json`; it contains all 300 raw predictions and
bound evaluation artifacts plus the complete earlier 995-pose experiment.
Large raw artifacts are not embedded in this compact GitHub review.

Files under `replay-tools/` are unchanged source copies in their original
execution-relative layout. Run them with the complete extracted evidence inputs,
not as a standalone replacement for those inputs. Their original bindings are
preserved. Core ranking code and focused tests live in the repository's ordinary
`scripts/external-ranking-v3/` and `tests/` directories.

Private connection keys, cloud-volume backups and unrelated account data are not
part of this publication. Full cloud cleanup evidence remains in the local task.
