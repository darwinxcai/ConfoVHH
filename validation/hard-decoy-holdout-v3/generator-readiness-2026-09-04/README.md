# Hard-decoy v3 generator readiness recovery

Status: **blocked before target freeze and MSA retrieval**.

This package records the repository state recovered on 2026-09-04. It does not authorize MSA retrieval, candidate generation, target freeze, label access, or benchmark execution.

## What is already complete

The canonical receptor TM1 through TM7 pregraph is complete and must not be regenerated. It contains 304 nodes and all 46,056 unordered receptor pairs. Of the 304 receptor profiles, 282 resolved to one canonical GPCRdb TM1 through TM7 sequence and 22 failed closed. The two GPCRdb captures agree after normalization.

The historical generator contract already pins the ColabFold 1.6.2 source commit and OCI image digests, the Boltz 2.2.1 wheel digest, and the Boltz confidence-checkpoint digest.

## Why final MSA retrieval is blocked

There is no exact frozen target manifest. The current public state still has 272 source entries awaiting disposition, zero formally cleared independent groups, and an incomplete broader discovery audit. The protocol requires at least ten formally cleared groups.

An additional contract defect was found during recovery. The historical rule says to retrieve one MSA per unique chain and reuse it offline. That is enough to freeze unpaired chain MSAs, but it is not enough for the configured `unpaired_paired` mode. ColabFold 1.6.2 and Boltz 2.2.1 each issue a separate joint paired-MSA request for a heteromeric target. The final contract must therefore do one of the following before target freeze:

1. freeze both per-sequence unpaired requests and per-target paired requests, including pairing strategy and server/database provenance; or
2. change the prespecified generator mode to unpaired-only.

Because receptor and VHH chains are not naturally encoded as an obligate operon-like pair, paired MSA depth may be sparse or biologically uninformative. That is a reason to decide the policy before target freeze, not a reason to change it after inspecting prediction results.

## Immutable assets still missing

- AlphaFold-Multimer v3 parameter archive SHA-256 and the checksum inventory of every extracted parameter file.
- A Boltz 2.2.1 environment image digest plus a hash-locked resolved dependency closure.
- The exact MSA server/database identity, or a fully pinned local MMseqs2 database snapshot.
- The request, retry, timeout, response, raw A3M, normalized A3M, and generator-specific processed-MSA ledgers.

The exact known hashes, missing fields, required retrieval units, and required output inventory are in `readiness.json`.
