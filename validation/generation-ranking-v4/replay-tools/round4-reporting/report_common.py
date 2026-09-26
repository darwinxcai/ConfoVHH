"""Portable, release-gated reporting I/O. No fit or molecular metric calls."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OWN_FILES = ('report_common.py', 'select_final.py', 'summarize_reserved.py', 'test_reporting.py', 'README.md')
PINS = {
    'round4-planning/ANALYSIS-DECISIONS.md': '7f76db198e105eb3ba5d5a5667bed499a43bfa2b4b23a34519169edb7ea7e6de',
    'round4-analysis/ANALYZER-FREEZE.json': '27f819320c6ed67459d68dbad6389aced7daa1e2449c0db35c49015270ffdaa0',
    'round4-ranking/COMBINED-DEVELOPMENT-TOOLS-FREEZE.json': 'ecfcb997a6208f053136222f7b41a480461e505314bfd0a9e4383d9f11222da6',
    'round4-ranking/IMPLEMENTATION-FREEZE-V2.json': '66b4469aa81e005ee58d885c0408b225de86435f62b71e59c7a72577948dfe41',
    'round4-ranking/FEATURE-ADAPTER-FREEZE.json': 'b0d59c38d86e5e3ebecc1cefba3b9ca4ad15d49d9c5f68ea8ded2cb9956eb685',
    'round4-outcomes/IMPLEMENTATION-FREEZE.json': '190329a887cb579c35f76f0a3c780fc35964d6a330e52e693d3f5bcfd05dde15',
    'round4-benchmark/ENROLLMENT.freeze.json': 'f43d145a873d2ccf6aeae8407fabc4596584bea9a82d8402c29f6d5361f096cb',
}

def check(value, message):
    if not value:
        raise ValueError(message)

def exact(value, keys):
    check(type(value) is dict and set(value) == set(keys), 'Unexpected artifact fields')

def finite(value):
    return type(value) in (int, float) and math.isfinite(value)

def strict(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            check(key not in result, 'Duplicate JSON property')
            result[key] = value
        return result
    def reject(value):
        raise ValueError('Nonfinite JSON constant: ' + value)
    def number(value):
        parsed = float(value)
        check(math.isfinite(parsed), 'Nonfinite JSON number: ' + value)
        return parsed
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject, parse_float=number)

def json_bytes(value):
    return (json.dumps(value, indent=2, allow_nan=False) + '\n').encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def safe(root, relative):
    root = Path(root)
    check(root.resolve() == root, 'Artifact root must be canonical')
    check(type(relative) is str and relative and not Path(relative).is_absolute()
          and '..' not in Path(relative).parts and '\\' not in relative
          and Path(relative).as_posix() == relative, 'Unsafe artifact path')
    path = root / relative
    check(path.resolve() == path and path.is_file() and not path.is_symlink(), 'Missing or indirect artifact: ' + relative)
    return path

def binding(root, path):
    path = Path(path)
    check(path.is_absolute() and path.is_relative_to(root), 'Binding outside artifact root')
    path = safe(root, path.relative_to(root).as_posix())
    raw = path.read_bytes()
    return {'path': path.relative_to(root).as_posix(), 'bytes': len(raw), 'sha256': sha(raw)}

def bound(root, value):
    exact(value, ('path', 'bytes', 'sha256'))
    check(type(value['bytes']) is int and value['bytes'] >= 0 and type(value['sha256']) is str
          and re.fullmatch('[0-9a-f]{64}', value['sha256']), 'Invalid binding size/digest')
    path = safe(root, value['path'])
    check(binding(root, path) == value, 'Changed artifact: ' + value['path'])
    return path

def load(root, value):
    return strict(bound(root, value).read_bytes())

def output_files(root, receipt_binding, files, names):
    folder = bound(root, receipt_binding).parent
    check(type(files) is list and len(files) == len(names), 'Wrong output roster length')
    expected = {(folder / name).relative_to(root).as_posix(): name for name in names}
    check({b['path'] for b in files} == set(expected), 'Output membership or receipt directory differs')
    return {expected[b['path']]: b for b in files}

def validate_freeze(root, freeze_binding):
    check(Path(root).resolve() == ROOT, 'Run the reporting code from the extracted artifact root')
    check(freeze_binding['path'] == 'round4-reporting/REPORTING-FREEZE.json', 'Wrong reporting freeze path')
    freeze = load(root, freeze_binding)
    exact(freeze, ('schema', 'status', 'files', 'dependencies', 'newDevelopmentOutcomesReadAtFreeze', 'reservedOutcomesReadAtFreeze'))
    check(freeze['schema'] == 'confovhh-round4-reporting-freeze-v1'
          and freeze['status'] == 'FROZEN_PENDING_SEPARATE_REPORTING_RELEASES'
          and freeze['newDevelopmentOutcomesReadAtFreeze'] is False
          and freeze['reservedOutcomesReadAtFreeze'] is False, 'Invalid reporting method freeze')
    check(len(freeze['files']) == len(OWN_FILES)
          and {b['path'] for b in freeze['files']} == {'round4-reporting/' + n for n in OWN_FILES}, 'Reporting code roster differs')
    for b in freeze['files']:
        bound(root, b)
    check(len(freeze['dependencies']) == len(PINS)
          and {b['path'] for b in freeze['dependencies']} == set(PINS), 'Dependency freeze roster differs')
    for b in freeze['dependencies']:
        check(b['sha256'] == PINS[b['path']], 'Frozen dependency differs')
        path = bound(root, b)
        if path.suffix == '.json':
            dependency = strict(path.read_bytes())
            # All executable dependencies declared by these freezes are reopened.
            for file in dependency.get('files', []):
                bound(root, file)
    return freeze

def dependency(root, relative, name):
    check(Path(root).resolve() == ROOT, 'Dependency root differs from reporting tree')
    # Frozen dependencies import these common names. Refuse cached host modules.
    origins = {'artifacts': 'round4-ranking/artifacts.py', 'ranker': 'round4-ranking/ranker.py',
               'run': 'round4-ranking/run.py', 'prepare_features': 'round4-ranking/prepare_features.py',
               'prepare_predictions': 'round4-outcomes/prepare_predictions.py'}
    for imported, expected in origins.items():
        if imported in sys.modules:
            check(Path(getattr(sys.modules[imported], '__file__', '')).resolve() == root / expected,
                  'Cached module from another artifact root: ' + imported)
    for directory in ('round4-ranking', 'round4-outcomes'):
        if str(root / directory) not in sys.path:
            sys.path.insert(0, str(root / directory))
    path = safe(root, relative)
    spec = importlib.util.spec_from_file_location('round4_reporting_' + name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

def write_bundle(root, output, documents, receipt):
    output = Path(output)
    check(output.is_absolute() and output.resolve() == output and output.is_relative_to(root / 'round4-reporting')
          and not output.exists(), 'Output must be a new canonical directory under round4-reporting')
    output.mkdir(parents=True)
    for name, raw in documents.items():
        check(Path(name).name == name, 'Unsafe output filename')
        with (output / name).open('xb') as stream:
            stream.write(raw)
    receipt = {**receipt, 'files': [binding(root, output / name) for name in documents]}
    with (output / 'receipt.json').open('xb') as stream:
        stream.write(json_bytes(receipt))
    return receipt

def replay_documents(root, receipt_binding, receipt, documents):
    outputs = output_files(root, receipt_binding, receipt['files'], documents)
    for name, expected in documents.items():
        check(bound(root, outputs[name]).read_bytes() == expected, 'Reporting bytes did not replay: ' + name)
