# Completed bounded eligibility review: 26 entries

**Nine exclusions, seventeen unresolved entries, no cleared independent group.** This closes the requested fixed-order review with accession-specific decisions, exact deposited polymer sequences and native residue maps. It does not claim that all missing sample or lineage facts have been recovered. The original 26-entry roster and protocol were bound before inspection in `review-plan.json`.

Eight entries lack the required GPCR-binding VHH: 6N4X and 6N52 contain no VHH, while 7TRK/7TRP/7TRQ/7TRS/8IA8/8J23 contain the G-protein helper scFv16. The ninth exclusion, 9VOS, has a deposited 4.3 Å resolution against the unchanged <=4.0 Å criterion. The alternative resolution reported in its paper is retained as a discrepancy, not substituted to clear the target.

Several real binders remain useful biological leads, but they are not new independent validation cases. Nb43 is reused across mGlu5 and engineered mGlu1; DN13 is shared by the two mGlu2 entries. The LGR4 megabody MB52 binds LGR4 directly: being a structural fiducial does not make it an antibody against an auxiliary protein. Its complete engineered construct cannot be replaced by the visible VHH fragment. NB18 and NB21 also bind LGR4 directly. RE02 directly binds mouse ADGRV1; its previously missing primary deposition link is now recovered. Nb20 directly binds GPR158/mGlyR, with a known engineered Nb20* descendant.

Read [the complete 26-entry decision table and dossiers](DECISIONS.md), [exposure and biology interpretation](BIOLOGY_AND_EXPOSURE.md), and [specific evidence-recovery actions](RECOVERY_ACTIONS.md). `decisions.json` is the machine-readable adjudication. `deposited-polymers.fasta` contains every deposited polymer, not launch-ready prediction inputs. `native-inspection.json.gz` contains all 26 full native inspections, including sequences, per-residue author/label maps, all interchain contact pairs, biological-assembly annotations and deposited engineering/source-reference categories. `chain-inventory.json` provides a compact chain table. `primary-source-guide.json`, `source-file-manifest.json` and `reused-evidence.json` bind original and reused evidence.

All observed residue identities match the corresponding deposited entity sequence. This verifies internal mapping only: missing receptor segments, fusion fragments, unknown tag cleavage and weak local density remain limitations. Native contacts were measured solely to inspect roles and mappings. No new prediction output, DockQ value, selector ranking or scoring variant was generated or inspected during this review.

The original inventory is untouched. Applying this append-only decision overlay to the previous 80-excluded/268-blocked inventory yields **89 excluded, 259 unresolved, zero cleared** out of the same 348 entries. The unreviewed remainder was not reassessed. Review groups preserve existing family components and add the verified M4–development-M2 family connection and the 9S38–9S37 identity link. They are not certified independent groups or a substitute for the whole-inventory transitive graph.

## Execution and replay

The native inspection ran locally in the retained scientific environment in 5.174621 seconds. No environment rebuild, GPU allocation, prediction, MSA generation or cloud charge occurred. Wall time for source retrieval and biological review is recorded separately from that computation. The empty `cleared-targets.json` is explicit: there is no first eligible target to prepare or price for launch under this protocol.

To reproduce native inspection, download the 26 exact mmCIF files from their bound URLs, verify `decisions.json` byte hashes first, then run:

```sh
python scripts/benchmark/inspect-exposure-review-26-v1.py --raw /path/to/raw --output /path/to/replay
python scripts/benchmark/verify-exposure-review-26-v1.py --raw /path/to/raw
```

The verifier checks all packaged identities and decisions and independently recomputes selected native contacts by dense distances, including negative helper controls, crystal-chain mapping, and both sides of a dimer-spanning epitope. Without `--raw`, it verifies the packaged evidence and unchanged reused files only. Raw source bytes and retrieved papers are retained in the checksum-verified local backup; public files contain provenance, sequences and derived native mapping evidence. Article bodies are not republished in the repository.

This package adds eligibility evidence only. The five frozen methods, exploratory predictor-native baseline, all prior losses/abstentions/missing records and the original 3P0G negative result retain their original bytes. The evaluator and scoring implementation are unchanged.
