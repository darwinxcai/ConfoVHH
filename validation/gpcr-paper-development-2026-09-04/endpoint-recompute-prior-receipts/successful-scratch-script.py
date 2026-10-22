#!/usr/bin/env python3
"""Independent raw-coordinate recomputation of the supplied DRY-to-TM6 endpoint.

This reproduces the declared motif-offset geometric measurement, not full GPCR
conformational state. It imports no supplied analysis implementation and no
ConfoVHH code. Source metric values are consulted only after distance calculation.
"""
from pathlib import Path
from collections import defaultdict, Counter
import csv, gzip, hashlib, io, json, math, re, sys, time
import Bio
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.Data.PDBData import protein_letters_3to1_extended

BASE = Path(__file__).resolve().parent
ROOT = BASE / "VERIFY"
SOURCE = BASE.parents[1] / "audit/GPCR_AI_review_PACKAGE/05_Supplementary"
OUT = BASE / "independent_tm3_tm6_v2"
if OUT.exists():
    raise SystemExit("Refusing to overwrite existing independent measurement artifact")
OUT.mkdir()

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def writejson(p, v):
    p.write_text(json.dumps(v, indent=2, sort_keys=True, allow_nan=False) + "\n")

def coordinates(p):
    text = gzip.open(p, "rt").read() if p.suffix == ".gz" else p.read_text()
    d = MMCIF2Dict(io.StringIO(text))
    keys = ["auth_asym_id", "label_asym_id", "label_seq_id", "auth_seq_id", "label_comp_id", "label_atom_id", "label_alt_id", "Cartn_x", "Cartn_y", "Cartn_z", "pdbx_PDB_model_num"]
    arrays = [d["_atom_site." + key] for key in keys]
    assert len({len(a) for a in arrays}) == 1
    residues = defaultdict(dict)
    ca = {}
    for auth, label, labelseq, authseq, comp, atom, alt, x, y, z, model in zip(*arrays):
        assert model == "1", (str(p), "multiple models")
        if labelseq in [".", "?"]:
            continue
        assert comp in protein_letters_3to1_extended, (str(p), comp)
        seqid = int(labelseq)
        identity = (label, authseq, comp)
        assert seqid not in residues[auth] or residues[auth][seqid] == identity
        residues[auth][seqid] = identity
        if atom == "CA":
            key = auth, seqid
            xyz = [float(x), float(y), float(z)]
            assert all(math.isfinite(v) for v in xyz)
            ca.setdefault(key, []).append({"alternateId": alt, "xyz": xyz})
    chains = {}
    for auth, res in residues.items():
        order = sorted(res)
        assert len({res[k][0] for k in order}) == 1
        sequence = "".join(protein_letters_3to1_extended[res[k][2]] for k in order)
        chains[auth] = {"labelAsymId": res[order[0]][0], "sequence": sequence, "order": order, "residues": res}
    return chains, ca

def measure(p, explicit_chain=None, request=None):
    chains, ca = coordinates(p)
    candidates = []
    for auth, chain in chains.items():
        seq = chain["sequence"]
        dry = list(re.finditer(r"D[RK]Y", seq))
        cwxp = list(re.finditer(r"[CTS]W[A-Z]P", seq))
        if len(dry) == 1 and len(cwxp) == 1:
            candidates.append((auth, dry[0], cwxp[0]))
    assert len(candidates) == 1, (str(p), "nonunique motif-bearing receptor", candidates)
    auth, dry, cwxp = candidates[0]
    if explicit_chain is not None:
        assert auth == explicit_chain, (str(p), "motif/S5 receptor disagreement")
    chain = chains[auth]
    if request is not None:
        submitted = [v["proteinChain"]["sequence"] for v in request["sequences"] if "proteinChain" in v]
        assert submitted.count(chain["sequence"]) == 1, (str(p), "model/request receptor sequence mismatch")
    i350 = dry.start() + 1
    # Declared protocol uses P6.50 minus 16 sequence positions as 6.34.
    i634 = cwxp.start() + 3 - 16
    assert 0 <= i634 < len(chain["order"])
    label350, label634 = chain["order"][i350], chain["order"][i634]
    endpoints = [ca[(auth, label350)], ca[(auth, label634)]]
    assert all(len(v) == 1 for v in endpoints), (str(p), "ambiguous selected-endpoint CA conformer")
    p350, p634 = [v[0]["xyz"] for v in endpoints]
    value = math.dist(p350, p634)
    return {
        "receptorAuthAsymId": auth, "receptorLabelAsymId": chain["labelAsymId"],
        "receptorObservedSequenceSha256": hashlib.sha256(chain["sequence"].encode()).hexdigest(),
        "receptorObservedResidues": len(chain["sequence"]),
        "dryMotif": dry.group(), "tm6Motif": cwxp.group(),
        "residue350": {"labelSeqId": label350, "authSeqId": chain["residues"][label350][1], "component": chain["residues"][label350][2], "caXYZAngstrom": p350},
        "residue634": {"labelSeqId": label634, "authSeqId": chain["residues"][label634][1], "component": chain["residues"][label634][2], "caXYZAngstrom": p634},
        "distanceAngstrom": value, "modelCountInCoordinate": 1,
        "selectedEndpointAlternateIds": [v[0]["alternateId"] for v in endpoints],
    }

source_rows = list(csv.DictReader((SOURCE / "S2_per_model_metrics.csv").open()))
index = {(r["job"], int(r["model"])): r for r in source_rows}
assert len(index) == len(source_rows)
rows = []
requests = {}
for path in sorted((ROOT / "runs").glob("*/*_model_*.cif")):
    job = path.parent.name
    model = int(re.search(r"_model_(\d+)\.cif$", path.name)[1])
    rp = path.parent / f"fold_{job.lower()}_job_request.json"
    if job not in requests:
        d = json.loads(rp.read_text())
        assert len(d) == 1 and d[0]["name"] == job
        requests[job] = d[0]
    measured = measure(path, request=requests[job])
    source = index[(job, model)]
    prior = float(source["tm3_tm6_A"])
    delta = measured["distanceAngstrom"] - prior
    exact_precision_match = f"{measured['distanceAngstrom']:.3f}" == f"{prior:.3f}"
    assert exact_precision_match, (job, model, measured["distanceAngstrom"], prior)
    assert source["residues"] == measured["residue350"]["component"] + "/" + measured["residue634"]["component"]
    rows.append({"job": job, "model": model, "reference": source["reference"],
                 "coordinatePath": str(path.relative_to(ROOT)), "coordinateSha256": sha(path),
                 "requestPath": str(rp.relative_to(ROOT)), "requestSha256": sha(rp),
                 **measured, "sourceReportedDistanceAngstrom": prior,
                 "recomputedMinusReportedAngstrom": delta, "matchesReportedAt0_001Angstrom": exact_precision_match})

refs = []
for reference in csv.DictReader((SOURCE / "S5_reference_provenance.csv").open()):
    path = ROOT / "references" / reference["file"]
    assert sha(path) == reference["sha256"]
    refs.append({"reference": reference["file"].split(".")[0], "coordinatePath": str(path.relative_to(ROOT)),
                 "coordinateSha256": sha(path), **measure(path, explicit_chain=reference["receptor_chain"])})

plan = json.loads((BASE / "cognate_scoring_plan.json").read_text())
cognate = {(j["jobId"], j["modelIndex"]) for j in plan["jobs"]}
assert len(rows) == 355 and len(cognate) == 165
assert all((j, i) in {(r["job"], r["model"]) for r in rows} for j, i in cognate)
with (OUT / "per_model.csv").open("w", newline="") as f:
    columns = ["job", "model", "reference", "coordinatePath", "coordinateSha256", "requestSha256", "receptorAuthAsymId", "distanceAngstrom", "sourceReportedDistanceAngstrom", "recomputedMinusReportedAngstrom", "matchesReportedAt0_001Angstrom"]
    writer = csv.DictWriter(f, fieldnames=columns)
    writer.writeheader()
    writer.writerows({k: r[k] for k in columns} for r in rows)
with (OUT / "per_model.jsonl").open("w") as f:
    for row in rows:
        f.write(json.dumps(row, sort_keys=True, allow_nan=False) + "\n")
writejson(OUT / "reference_measurements.json", refs)
writejson(OUT / "summary.json", {
    "status": "COMPLETE", "dataRole": "independent-recomputation-of-supplied-retrospective-coordinates",
    "independentBiologicalValidation": False,
    "method": "Unique receptor chain with one D[RK]Y and one [CTS]W[A-Z]P motif; sequence matched to one submitted protein. C-alpha Euclidean distance from R/K in D[RK]Y to residue sixteen sequence positions before the motif proline. Residues ordered by mmCIF label_seq_id. Selected endpoint alpha carbons must each have exactly one conformer; non-endpoint alternate conformers do not affect the measurement. No supplied analysis module imported.",
    "priorAttempt": "independent_tm3_tm6_v1/failure.json records an overly broad native alternate-conformer guard; no endpoint definition or data inclusion was changed.",
    "createdAtUnix": time.time(), "scriptSha256": sha(Path(__file__)),
    "python": sys.version, "biopythonVersion": Bio.__version__,
    "bioMmcifDictionaryParserSha256": sha(Path(sys.modules[MMCIF2Dict.__module__].__file__)),
    "sourceS2Sha256": sha(SOURCE / "S2_per_model_metrics.csv"), "sourceS5Sha256": sha(SOURCE / "S5_reference_provenance.csv"),
    "rawRoot": str(ROOT), "rawModelsRecomputed": len(rows), "rawJobs": len({r["job"] for r in rows}),
    "modelsMatchingPublished0_001AngstromPrecision": sum(r["matchesReportedAt0_001Angstrom"] for r in rows),
    "maxAbsoluteDifferenceFromRoundedSourceAngstrom": max(abs(r["recomputedMinusReportedAngstrom"]) for r in rows),
    "reviewedCognateModelsRecomputed": len(cognate),
    "recomputedReferenceStructures": len(refs), "missingRawModelsUnverified": 105,
    "nativeDistancesAngstrom": {r["reference"]: r["distanceAngstrom"] for r in refs},
    "outputSha256": {p.name: sha(p) for p in OUT.iterdir() if p.is_file()},
    "interpretation": "Confirms reproduction of the declared coarse endpoint measurement from retained coordinates. Does not independently validate generic-position assignments or establish full receptor state, ligand dependence, or binding.",
})
print((OUT / "summary.json").read_text())
