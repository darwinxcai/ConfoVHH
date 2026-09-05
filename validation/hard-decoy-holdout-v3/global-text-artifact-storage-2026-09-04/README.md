# Lossless storage of two large derived artifacts

The publishing transport cannot carry the two large derived JSONL files individually. Their exact canonical bytes are stored here as deterministic gzip archives, generated with level 9 compression and zero gzip modification timestamps. No records or fields were removed. All original raw captures remain tracked, and neither completed packet's canonical checksums, inventory, normalizer, screen implementation or source-epoch hashes changed.

| Restored canonical artifact | Original bytes | Gzip bytes |
| --- | ---: | ---: |
| `global-text-discovery-2026-09-04/entries.jsonl` | 22,693,263 | 4,562,608 |
| `global-text-screen-2026-09-04/entity-screens.jsonl` | 42,079,134 | 1,695,359 |

Before manually replaying either original packet, run from the repository root:

```sh
node scripts/hard-decoy-v3/restore-global-text-artifacts.mjs
```

The global text snapshot test runs this helper automatically, so ordinary test and coverage runs hydrate a fresh checkout before replaying the evidence. The two reconstructed paths alone are ignored by Git; existing physical files may remain in the working tree.

The offline helper accepts only those exact two destination paths. It verifies its pinned manifest, compressed sizes and hashes, bounded decompression, uncompressed sizes and hashes, and the original packet checksum entries. It rejects symlinked paths and mismatched existing files; it never overwrites them. Both archives and existing destinations are validated before either missing file is created. The restore command can be repeated safely when the files already match.

After restoration, use the unchanged canonical replays:

```sh
node scripts/hard-decoy-v3/capture-global-text-discovery.mjs verify validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04
node scripts/hard-decoy-v3/screen-gpcrdb-complement.mjs verify validation/hard-decoy-holdout-v3/global-text-discovery-2026-09-04 validation/hard-decoy-holdout-v3/global-text-screen-2026-09-04
python3 -B validation/hard-decoy-holdout-v3/global-text-capture-review-2026-09-04/build.py verify
```

Compression is storage only. The census remains incomplete, the protocol remains DRAFT and target freeze remains BLOCKED.
