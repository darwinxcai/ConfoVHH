#!/usr/bin/env python3
"""Development-only, local-input Boltz pilot. No downloads or scoring.

JSON inputs are valid YAML. Every path handed to Boltz is absolute. A directory
alone never establishes completion; inputs, five paired outputs and hashes do.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_bytes(encoded(value))
    temporary.replace(path)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def artifact(record, base):
    require(isinstance(record, dict), "missing artifact record")
    require(re.fullmatch(r"[0-9a-f]{64}", str(record.get("sha256", ""))), "missing SHA-256")
    path = Path(record["path"])
    path = (base / path).resolve() if not path.is_absolute() else path.resolve()
    require(path.is_file() and not path.is_symlink(), f"missing artifact: {path}")
    require(digest(path) == record["sha256"], f"hash mismatch: {path}")
    return path


def import_jobs(source, output):
    source, output = Path(source), Path(output)
    provenance = list(csv.DictReader((source / "template_provenance.csv").open()))
    templates = {row["pdb_id"]: row for row in provenance}
    jobs = []
    for path in sorted((source / "yaml").glob("*.yaml")):
        content = path.read_text()
        # Strictly accept the restricted source format, not general YAML.
        pattern = r"  - protein:\n      id: ([A-Z])\n      sequence: ([A-Z]+)"
        chains = [{"id": chain, "sequence": seq,
                   "sequence_sha256": hashlib.sha256(seq.encode()).hexdigest()}
                  for chain, seq in re.findall(pattern, content)]
        hits = [{"pdb_id": pdb, "chain_id": chain}
                for pdb, chain in re.findall(
                    r"  - cif: ../templates/([A-Z0-9]{4})\.cif\n    chain_id: ([A-Z])", content)]
        reconstructed = "version: 1\nsequences:\n" + "\n".join(
            f"  - protein:\n      id: {c['id']}\n      sequence: {c['sequence']}" for c in chains) + "\n"
        if hits:
            reconstructed += "templates:\n" + "\n".join(
                f"  - cif: ../templates/{t['pdb_id']}.cif\n    chain_id: {t['chain_id']}" for t in hits) + "\n"
        require(content == reconstructed and chains, f"unsupported source YAML: {path.name}")
        require(all(t["pdb_id"] in templates for t in hits), f"missing template provenance: {path.name}")
        seed = re.fullmatch(r"[A-Za-z0-9_]+_seed([0-9]+)", path.stem)
        require(seed, f"invalid job name: {path.stem}")
        jobs.append({"job": path.stem, "seed": int(seed[1]), "diffusion_samples": 5,
                     "chains": chains, "templates": hits, "source_yaml_sha256": digest(path)})
    require(jobs, "no source jobs")
    write(output / "jobs.json", {"schema": 1, "scope": "development_only",
          "source": "GPCR_handoff_bundle.zip/boltz_arm.zip/boltz",
          "comparison": "accession-matched; not identical AF3/Boltz inputs or paired random seeds",
          "template_provenance_sha256": digest(source / "template_provenance.csv"), "jobs": jobs})
    (output / "template_provenance.csv").write_bytes((source / "template_provenance.csv").read_bytes())
    return {"jobs": len(jobs), "expected_models": sum(j["diffusion_samples"] for j in jobs),
            "distinct_sequences": len({c["sequence_sha256"] for j in jobs for c in j["chains"]}),
            "templates": len(templates), "live_predictions_run": 0}


def validate_job(job):
    require(re.fullmatch(r"[A-Za-z0-9_]+_seed[0-9]+", job["job"]), "unsafe job name")
    require(job["diffusion_samples"] == 5, "this pilot requires five samples")
    require(isinstance(job["seed"], int) and job["seed"] >= 0, "invalid seed")
    require(int(job["job"].rsplit("_seed", 1)[1]) == job["seed"], "job/seed identity mismatch")
    ids = [c["id"] for c in job["chains"]]
    require(len(ids) == len(set(ids)) and ids, "duplicate/empty chain identities")
    for chain in job["chains"]:
        require(re.fullmatch(r"[A-Z]", chain["id"]), "invalid chain identity")
        require(re.fullmatch(r"[ACDEFGHIKLMNPQRSTVWY]+", chain["sequence"]), "unsupported sequence")
        require(hashlib.sha256(chain["sequence"].encode()).hexdigest() == chain["sequence_sha256"],
                "sequence hash mismatch")
    require(all(t["chain_id"] in ids for t in job["templates"]), "unknown template query chain")
    pairs = [(t["pdb_id"], t["chain_id"]) for t in job["templates"]]
    require(len(set(pairs)) == len(pairs), "duplicate template/query pair")
    require(all(re.fullmatch(r"[A-Z0-9]{4}", pdb) for pdb, _ in pairs), "invalid template accession")


def prepare(job, pins, base, template_provenance):
    validate_job(job)
    sequences, template_inputs = [], []
    sources = []
    for chain in job["chains"]:
        record = pins.get("msas", {}).get(chain["sequence_sha256"])
        path = artifact(record, base)
        require(path.suffix == ".a3m", "MSAs must be cached A3M files")
        require(isinstance(record.get("provenance"), dict) and record["provenance"].get("method")
                and record["provenance"].get("database") and record["provenance"].get("created_utc"),
                "MSA generation provenance incomplete")
        lines = path.read_text().splitlines()
        require(lines and lines[0].startswith(">"), "invalid A3M header")
        query = ""
        for line in lines[1:]:
            if line.startswith(">"):
                break
            query += line.strip()
        require(query.replace("-", "") == chain["sequence"], "MSA query/sequence mismatch")
        sequences.append({"protein": {"id": chain["id"], "sequence": chain["sequence"], "msa": str(path)}})
        sources.append({"kind": "msa", "path": str(path), "sha256": record["sha256"],
                        "provenance": record["provenance"]})
    for template in job["templates"]:
        pdb = template["pdb_id"]
        record = pins.get("templates", {}).get(pdb)
        path = artifact(record, base)
        require(record["sha256"] == template_provenance[pdb]["sha256"], f"source template hash mismatch: {pdb}")
        require(path.stat().st_size == int(template_provenance[pdb]["bytes"]), f"source template size mismatch: {pdb}")
        key = f"{job['job']}:{template['chain_id']}:{pdb}"
        target = pins.get("template_chains", {}).get(key)
        require(isinstance(target, str) and target, f"template chain mapping absent: {key}")
        template_inputs.append({"cif": str(path), "chain_id": template["chain_id"], "template_id": target})
        sources.append({"kind": "template", "path": str(path), "sha256": record["sha256"]})
    document = {"version": 1, "sequences": sequences}
    if template_inputs:
        document["templates"] = template_inputs
    return document, sources


RUNTIME_PROBE = '''import importlib.metadata as m, pathlib, hashlib, json, boltz
p=pathlib.Path(boltz.__file__).resolve().parent
files=[[str(f.relative_to(p)), hashlib.sha256(f.read_bytes()).hexdigest()] for f in sorted(p.rglob("*.py"))]
print(json.dumps({"version":m.version("boltz"),"source_sha256":hashlib.sha256(json.dumps(files,separators=(",",":"),ensure_ascii=True).encode()).hexdigest(),"packages":sorted([[d.metadata["Name"],d.version] for d in m.distributions()])}))'''


def preflight(job, pins, base, document, sources):
    require(pins.get("schema") == 1 and pins.get("scope") == "development_only", "invalid pin scope")
    runtime = pins.get("runtime", {})
    python = artifact(runtime.get("python"), base)
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", runtime.get("boltz_version", "")), "exact Boltz version required")
    require(re.fullmatch(r"[0-9a-f]{64}", runtime.get("boltz_source_sha256", "")), "Boltz source hash required")
    probe = subprocess.run([str(python), "-c", RUNTIME_PROBE], capture_output=True, text=True, timeout=60)
    require(probe.returncode == 0, "Boltz environment probe failed: " + probe.stderr[-2000:])
    observed = json.loads(probe.stdout)
    require(observed["version"] == runtime["boltz_version"], "Boltz version mismatch")
    require(observed["source_sha256"] == runtime["boltz_source_sha256"], "Boltz source hash mismatch")
    checkpoint = artifact(pins.get("checkpoint"), base)
    cache = (base / pins["cache"]["path"]).resolve()
    files = pins["cache"].get("files", [])
    expected = {item["path"] for item in files}
    require({"boltz2_conf.ckpt", "boltz2_aff.ckpt", "mols.tar"} <= expected,
            "pre-staged cache artifacts required to avoid implicit downloads")
    require((cache / "mols").is_dir() and any(p.startswith("mols/") for p in expected),
            "pre-extracted, hashed molecule cache required")
    actual = {str(p.relative_to(cache)) for p in cache.rglob("*") if p.is_file()}
    require(actual == expected, "cache inventory differs from pin manifest")
    for record in files:
        require(not Path(record["path"]).is_absolute() and ".." not in Path(record["path"]).parts, "unsafe cache path")
        artifact(record, cache)
    require(digest(cache / "boltz2_conf.ckpt") == pins["checkpoint"]["sha256"], "checkpoint/cache mismatch")
    if job["templates"]:
        evidence_path = artifact(pins.get("template_parse_evidence", {}).get(job["job"]), base)
        evidence = read(evidence_path)
        require(evidence.get("job") == job["job"] and evidence.get("boltz_version") == observed["version"]
                and evidence.get("boltz_source_sha256") == observed["source_sha256"]
                and evidence.get("input_sha256") == hashlib.sha256(encoded(document)).hexdigest(),
                "parsed-template evidence does not match job/input/software")
        mappings = evidence.get("template_records", [])
        require(len(mappings) == len(job["templates"]), "parsed-template evidence count mismatch")
        found = set()
        for row in mappings:
            key = (row["pdb_id"], row["chain_id"], row["template_id"])
            require(key not in found, "duplicate parsed-template evidence")
            found.add(key)
            q, t = row.get("query_indices", []), row.get("template_indices", [])
            require(len(q) == len(t) and len(q) > 0 and all(type(i) is int and i >= 0 for i in q + t),
                    "parsed-template alignment indices missing/invalid")
            require(len(set(q)) == len(q) and len(set(t)) == len(t), "duplicate alignment indices")
            lengths = {c["id"]: len(c["sequence"]) for c in job["chains"]}
            require(row["chain_id"] in lengths and max(q) < lengths[row["chain_id"]], "query alignment out of bounds")
        wanted = {(t["pdb_id"], t["chain_id"], pins["template_chains"][f"{job['job']}:{t['chain_id']}:{t['pdb_id']}"])
                  for t in job["templates"]}
        require(found == wanted, "parsed template mappings mismatch")
        sources.append({"kind": "template_parse_evidence", "path": str(evidence_path), "sha256": digest(evidence_path)})
    verified_assets = [{"path": str(python), "sha256": runtime["python"]["sha256"]},
                       {"path": str(checkpoint), "sha256": pins["checkpoint"]["sha256"]}]
    verified_assets += [{"path": str(cache / item["path"]), "sha256": item["sha256"]} for item in files]
    record = {"job": job, "input": document, "pins": pins, "sources": sources,
              "verified_assets": verified_assets,
              "cache_inventory": {"path": str(cache), "files": sorted(expected)},
              "runtime_observed": observed, "runner_sha256": digest(__file__)}
    return {"fingerprint": hashlib.sha256(encoded(record)).hexdigest(), "record": record,
            "python": str(python), "checkpoint": str(checkpoint), "cache": str(cache)}


AA = dict(zip("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split(), "ARNDCQEGHILKMFPSTWYV"))


def validate_cif(path, chains):
    """Conservative atom-site validator; unsupported CIF syntax fails closed.

    Check finite coordinates and exactly one CA for each expected residue/chain.
    This is file/identity validation, not stereochemical or scientific validation.
    """
    lines = path.read_text().splitlines()
    require(any(line.startswith("data_") for line in lines), f"CIF data block absent: {path}")
    found = {}
    loops = 0
    for start, line in enumerate(lines):
        if line.strip() != "loop_":
            continue
        index, columns = start + 1, []
        while index < len(lines) and lines[index].startswith("_"):
            columns.append(lines[index].strip())
            index += 1
        if not columns or not all(c.startswith("_atom_site.") for c in columns):
            continue
        loops += 1
        required = ["label_atom_id", "label_asym_id", "label_seq_id", "label_comp_id", "Cartn_x", "Cartn_y", "Cartn_z"]
        require(all("_atom_site." + name in columns for name in required), "CIF atom-site columns absent")
        rows = []
        while index < len(lines):
            text = lines[index].strip()
            if text.startswith(("#", "_", "loop_", "data_")):
                break
            require(not text.startswith(";"), "multiline atom-site values unsupported")
            rows += [t[1:-1] if t.startswith(("'", '"')) and t[-1:] == t[:1] else t
                     for t in re.findall(r"'[^'\n]*'(?=\s|$)|\"[^\"\n]*\"(?=\s|$)|[^\s]+", text)]
            index += 1
        require(rows and len(rows) % len(columns) == 0, "truncated CIF atom-site loop")
        for offset in range(0, len(rows), len(columns)):
            row = dict(zip([c[11:] for c in columns], rows[offset:offset + len(columns)]))
            require(all(math.isfinite(float(row[c])) for c in ("Cartn_x", "Cartn_y", "Cartn_z")), "nonfinite CIF coordinate")
            if row["label_atom_id"] != "CA":
                continue
            key = (row["label_asym_id"], int(row["label_seq_id"]))
            require(key not in found, "duplicate CA residue identity")
            require(row["label_comp_id"] in AA, "unknown amino acid")
            found[key] = AA[row["label_comp_id"]]
    require(loops == 1, "exactly one atom-site loop required")
    expected = {(c["id"], index): aa for c in chains for index, aa in enumerate(c["sequence"], 1)}
    require(found == expected, "CIF chain/residue sequence identity mismatch")


def validate_outputs(attempt, job):
    folder = attempt / "out" / f"boltz_results_{job['job']}" / "predictions" / job["job"]
    expected = {f"{job['job']}_model_{i}.cif" for i in range(5)}
    confidence = {f"confidence_{job['job']}_model_{i}.json" for i in range(5)}
    require(folder.is_dir(), "prediction directory absent")
    require({p.name for p in folder.glob("*_model_*.cif")} == expected, "five exact CIF model identities required")
    require({p.name for p in folder.glob("confidence_*.json")} == confidence, "five exact confidence identities required")
    records = []
    for index in range(5):
        cif = folder / f"{job['job']}_model_{index}.cif"
        conf = folder / f"confidence_{job['job']}_model_{index}.json"
        require(not cif.is_symlink() and not conf.is_symlink(), "symlinked prediction output")
        validate_cif(cif, job["chains"])
        values = read(conf)
        keys = ["confidence_score", "ptm", "complex_plddt"]
        if len(job["chains"]) > 1:
            keys.append("iptm")
        for key in keys:
            value = values.get(key)
            require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1,
                    f"invalid confidence field {key}, model {index}")
        for path in (cif, conf):
            records.append({"path": str(path.relative_to(attempt)), "sha256": digest(path), "model": index})
    return records


def completion_artifacts(attempt, job):
    records = validate_outputs(attempt, job)
    require(read(attempt / "status.json") == {"status": "complete", "exit_code": 0}, "attempt has no successful exit record")
    for name in (job["job"] + ".yaml", "provenance.json", "command.json", "status.json", "stdout.log", "stderr.log"):
        records.append({"path": name, "sha256": digest(attempt / name)})
    return records


def verify_execution_inputs(prepared):
    """Recheck after the process exits, before assigning successful provenance.

    This detects persistent mutation during a run. It cannot detect an artifact
    changed and restored between checks; an immutable filesystem/container is
    still needed to eliminate that time-of-check/time-of-use limitation.
    """
    record = prepared["record"]
    for source in record["sources"] + record["verified_assets"]:
        artifact(source, Path("/"))
    cache = record.get("cache_inventory")
    if cache:
        root = Path(cache["path"])
        actual = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())
        require(actual == cache["files"], "cache inventory changed during execution")
    if record.get("runtime_observed") is not None:
        probe = subprocess.run([prepared["python"], "-c", RUNTIME_PROBE], capture_output=True, text=True, timeout=60)
        require(probe.returncode == 0, "post-run environment probe failed")
        require(json.loads(probe.stdout) == record["runtime_observed"], "runtime environment changed during execution")
    require(digest(__file__) == record["runner_sha256"], "runner source changed during execution")


def verify_complete(job, prepared, root):
    complete = read(root / "COMPLETE.json")
    require(complete["fingerprint"] == prepared["fingerprint"], "completed job inputs changed; use a new output root")
    attempt = (root / complete["attempt"]).resolve()
    require(attempt.parent == (root / "attempts").resolve(), "invalid completion attempt path")
    require(completion_artifacts(attempt, job) == complete["outputs"], "completed output/provenance hashes changed")
    return {"status": "verified_complete", "job": job["job"], "attempt": str(attempt)}


def execute(job, prepared, out, retry=False, command=None):
    root = Path(out).resolve() / job["job"]
    root.mkdir(parents=True, exist_ok=True)
    lock = root / "RUNNING.lock"
    # Exclusive create prevents two runners from racing on the same job.
    with lock.open("x") as handle:
        handle.write(datetime.now(timezone.utc).isoformat())
    try:
        marker = root / "COMPLETE.json"
        if marker.exists():
            return verify_complete(job, prepared, root)
        attempts = root / "attempts"
        if attempts.exists() and any(attempts.iterdir()):
            require(retry, "prior incomplete attempt exists; inspect it and use --retry to preserve it and try again")
        attempt = attempts / uuid.uuid4().hex
        attempt.mkdir(parents=True)
        input_path = attempt / (job["job"] + ".yaml")
        input_path.write_bytes(encoded(prepared["record"]["input"]))
        write(attempt / "provenance.json", prepared["record"])
        argv = command or [prepared["python"], "-m", "boltz.main", "predict", str(input_path),
                           "--out_dir", str(attempt / "out"), "--cache", prepared["cache"],
                           "--checkpoint", prepared["checkpoint"], "--model", "boltz2",
                           "--seed", str(job["seed"]), "--diffusion_samples", "5",
                           "--recycling_steps", "3", "--sampling_steps", "200",
                           "--output_format", "mmcif", "--devices", "1", "--num_workers", "0"]
        write(attempt / "command.json", {"argv": argv})
        try:
            with (attempt / "stdout.log").open("w") as stdout, (attempt / "stderr.log").open("w") as stderr:
                result = subprocess.run(argv, cwd=attempt, stdout=stdout, stderr=stderr, check=False)
            require(result.returncode == 0, f"Boltz command failed with exit {result.returncode}")
            validate_outputs(attempt, job)
            verify_execution_inputs(prepared)
            write(attempt / "status.json", {"status": "complete", "exit_code": result.returncode})
            outputs = completion_artifacts(attempt, job)
            write(marker, {"schema": 1, "fingerprint": prepared["fingerprint"],
                           "attempt": str(attempt.relative_to(root)), "outputs": outputs})
            return {"status": "complete", "job": job["job"], "attempt": str(attempt)}
        except Exception as exc:
            write(attempt / "status.json", {"status": "failed_or_incomplete", "error": str(exc)})
            raise
    finally:
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["import", "prepare", "readiness", "run", "verify"])
    parser.add_argument("--source")
    parser.add_argument("--manifest")
    parser.add_argument("--pins")
    parser.add_argument("--job")
    parser.add_argument("--out", required=True)
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    try:
        if args.action == "import":
            result = import_jobs(args.source, args.out)
        else:
            require(args.manifest and args.pins and args.job, "--manifest, --pins and one --job required")
            manifest = read(args.manifest)
            require(manifest.get("scope") == "development_only", "development scope required")
            selected = [j for j in manifest["jobs"] if j["job"] == args.job]
            require(len(selected) == 1, "job missing or duplicated")
            pins = read(args.pins)
            base = Path(args.pins).resolve().parent
            provenance_path = Path(args.manifest).resolve().parent / "template_provenance.csv"
            require(digest(provenance_path) == manifest["template_provenance_sha256"], "template provenance hash mismatch")
            provenance = {r["pdb_id"]: r for r in csv.DictReader(provenance_path.open())}
            document, sources = prepare(selected[0], pins, base, provenance)
            if args.action == "prepare":
                path = Path(args.out) / (args.job + ".yaml")
                write(path, document)
                result = {"status": "input_prepared_only", "input": str(path.resolve()), "sha256": digest(path),
                          "parser_validation": "not_performed", "inference": "not_run"}
            else:
                prepared = preflight(selected[0], pins, base, document, sources)
                if args.action == "readiness":
                    result = {"status": "local_prerequisites_verified", "fingerprint": prepared["fingerprint"],
                              "real_inference_smoke_test": "not_performed_by_readiness"}
                else:
                    if args.action == "verify":
                        result = verify_complete(selected[0], prepared, Path(args.out).resolve() / args.job)
                    else:
                        result = execute(selected[0], prepared, args.out, retry=args.retry)
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "blocked_or_failed", "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
