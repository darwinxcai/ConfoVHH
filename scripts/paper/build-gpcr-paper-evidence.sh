#!/usr/bin/env bash
# Rebuild the paper tables and measured figure from completed, verified receipts.
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/paper/build-gpcr-paper-evidence.sh /fresh/output/directory" >&2
  exit 2
fi
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
study="$repo_root/validation/gpcr-paper-development-2026-09-04"
paper_out=$1
if [[ -e "$paper_out" ]]; then
  echo "Output already exists; choose a fresh directory: $paper_out" >&2
  exit 2
fi
mkdir -p -- "$paper_out"
python3 -B "$repo_root/scripts/paper/summarize-gpcr-development.py" \
  --study "$study" --out "$paper_out/results"
python3 -B "$repo_root/scripts/paper/plot-gpcr-development.py" \
  --results "$paper_out/results" --out "$paper_out/figures"
echo "GPCR PAPER EVIDENCE BUILD OK"
