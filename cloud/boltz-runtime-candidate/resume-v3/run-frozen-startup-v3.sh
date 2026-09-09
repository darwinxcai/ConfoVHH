#!/bin/bash
# Approved startup wrapper v2; the frozen runner and its timeouts stay unchanged.
# The independent controller owns cloud shutdown and passes its actual deadline.
set -Eeuo pipefail
umask 077
if [[ $# != 2 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  printf '%s\n' 'Usage: run-frozen-startup-v3.sh EXECUTION_ID ABSOLUTE_DEADLINE_UTC' >&2
  exit 2
fi
execution="/workspace/executions/$1"
results="$execution/runtime-results"
test -d "$results"
test ! -L "$execution"
test ! -L "$results"
test ! -e "$results/runner-wrapper.log"
test ! -e "$results/runner-exit.txt"
set -o noclobber
exec >"$results/runner-wrapper.log" 2>&1
trap 'rc=$?; printf "phase=generation exit=%s time=%s\n" "$rc" "$(date -u +%FT%TZ)" > "$results/runner-exit.txt"; exit "$rc"' EXIT
cd /workspace/ConfoVHH
sha256sum --check SHA256SUMS
helper_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env -u PYTHONPATH -u PYTHONHOME /opt/confovhh-boltz/bin/python -I \
  "$helper_dir/verify-startup-gates-v3.py" "$1" "$2"
test ! -e "$execution/3p0g-pilot-output"
export CC=/usr/bin/gcc
export CXX=/usr/bin/g++
env -u PYTHONPATH -u PYTHONHOME /opt/confovhh-boltz/bin/python -I \
  /workspace/ConfoVHH/scripts/paper/run-single-case-generation.py \
  --inputs /workspace/generation-inputs \
  --cache /workspace/boltz-cache \
  --python /opt/confovhh-boltz/bin/python \
  --output "$execution/3p0g-pilot-output"
