"""Round4 format-dispatch repair; unchanged pinned round3 metric and mappings.

DockQ2.1.3 load_PDB can silently return an empty PDB parse for valid mmCIF.
Canonical views are explicitly mmCIF, so select its own MMCIFParser directly.
Only the two loader expressions are changed in the hash-verified old function.
"""
from __future__ import annotations
import ast,functools,hashlib,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SHA=lambda b:hashlib.sha256(b).hexdigest()

def load_explicit_mmcif(path,chains,n_model=0):
    import DockQ.DockQ as dq
    filename=Path(path)
    if filename.suffix.lower() not in {'.cif','.mmcif'}:
        raise ValueError('Round4 metric requires an explicitly canonical mmCIF view')
    if chains!=['R','V'] or n_model!=0:
        raise ValueError('Round4 metric selected-role/model policy differs')
    with filename.open('rt',encoding='utf-8') as handle:
        if not handle.read(4096).lstrip().startswith('data_'):
            raise ValueError('Canonical mmCIF data header missing')
        handle.seek(0)
        model=dq.MMCIFParser(QUIET=True).get_structure('-',handle,chains=chains,
            parse_hetatms=False,auth_chains=True,model_number=n_model)
    model.id=str(filename)
    if set(model.child_dict)!={'R','V'} or any(len(model[c])==0 for c in ['R','V']):
        raise ValueError('Explicit mmCIF parser did not load exactly nonempty R and V')
    return model

@functools.lru_cache(maxsize=4)
def _load(root_string):
    root=Path(root_string).resolve()
    oldpath=root/'round3-benchmark/outcome-tools/outcome_adapter.py'
    spec=importlib.util.spec_from_file_location('_confovhh_round3_pinned_outcome_adapter',oldpath)
    old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
    original=old.implementation(root)  # Independently enforces existing immutable method/package lock.
    method=json.loads((root/'round3-benchmark/outcome-tools/METHOD-FREEZE.json').read_text())
    full=oldpath.read_text();node=next(n for n in ast.parse(full).body if isinstance(n,ast.FunctionDef) and n.name=='dockq_api')
    scientific=ast.get_source_segment(full,node)
    if SHA(scientific.encode())!=method['functionSourceSha256']['dockq_api']:
        raise ValueError('Frozen DockQ function source differs')
    replacements=[('model=dq.load_PDB(str(model_path),chains=[\'R\',\'V\'],n_model=0)',
                   'model=load_explicit_mmcif(str(model_path),chains=[\'R\',\'V\'],n_model=0)'),
                  ('native=dq.load_PDB(str(native_path),chains=[\'R\',\'V\'],n_model=0)',
                   'native=load_explicit_mmcif(str(native_path),chains=[\'R\',\'V\'],n_model=0)')]
    derived=scientific
    for before,after in replacements:
        if derived.count(before)!=1:raise ValueError('Expected exactly one loader expression')
        derived=derived.replace(before,after)
    # Reversing only the documented dispatch substitutions must recover every old byte.
    restored=derived
    for before,after in replacements:restored=restored.replace(after,before)
    if restored!=scientific:raise ValueError('Unexpected numerical function change')
    namespace=dict(old.__dict__);namespace['load_explicit_mmcif']=load_explicit_mmcif
    exec(compile(derived,'<round4-explicit-mmcif-dispatch>','exec'),namespace)
    info={'schema':'confovhh-round4-explicit-mmcif-metric-v1','change':'Only format dispatch: two load_PDB expressions replaced by explicit pinned DockQ.MMCIFParser; every other numerical-function byte unchanged.',
          'round3':original,'originalDockqApiSourceSha256':SHA(scientific.encode()),
          'derivedDockqApiSourceSha256':SHA(derived.encode()),'helperSha256':SHA(Path(__file__).read_bytes()),
          'inputFormat':'mmCIF only; data_ header required','selectedChains':['R','V'],'modelIndex':0,
          'authChains':True,'parseHetatms':False,'numericalMetricChanged':False,'correspondenceChanged':False,
          'originalFrozenFilesEdited':False}
    return namespace['dockq_api'],info

def implementation(execution_root=ROOT):
    return _load(str(Path(execution_root).resolve()))[1]

def dockq_api(model_path,native_path,model_mapping,native_mapping,execution_root=ROOT):
    return _load(str(Path(execution_root).resolve()))[0](model_path,native_path,model_mapping,native_mapping)
