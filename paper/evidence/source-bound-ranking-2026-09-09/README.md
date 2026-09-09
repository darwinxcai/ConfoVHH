# Generated source-bound selection control

This packet contains generated alanine-fragment coordinates and fabricated
confidence JSON in the **file format** of Boltz. Boltz was not run. Its binary
outcome labels are deliberately arbitrary and opposite across the two toy seeds.
No native GPCR, VHH prediction, biological outcome or independent group was used.

The command reads all declared files from disk, verifies identities, extracts
reported-format scores, audits the toy coordinates, exports ranks and evaluates
each declared job before aggregation. Four eligible models and one failed
attempt produce two complete selection sets in one declared toy component.
Expected method success=0.5, baseline=0.5, paired difference=0. This confirms
arithmetic/integration only. No uncertainty or biological accuracy is inferred.

Regenerate into a new directory (parent must already exist):

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/paper/demo-source-bound-selection.mjs /tmp/new-source-selection-demo
```

The generated `input.json`, exact artifacts, `rank-receipt.json`,
`comparison-input.json` and `comparison-receipt.json` are retained. Audit timestamps
change on replay; file identities, extracted values, ranks and arithmetic remain
checkable. Policy hashes bind source/runtime identities and can change with
versioned implementation changes. The checksum inventory covers retained bytes.
