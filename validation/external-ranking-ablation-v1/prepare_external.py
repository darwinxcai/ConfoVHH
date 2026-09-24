"""Bind recovered public coordinates and source-score JSON; no outcomes in scorer input."""
import csv, hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def bound(p, **extra):
 p=Path(p); p=p if p.is_absolute() else ROOT/p
 b=p.read_bytes()
 return dict(path=str(p.relative_to(ROOT)),bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),**extra)
manifest=dict(schema='confovhh-external-development-input-v1',studyId='external-ranking-ablation-v1',
 generators=[dict(id='chai1',scoreName='iptm',direction='higher-better'),dict(id='lightdock',scoreName='LightDock-score',direction='higher-better'),dict(id='haddock',scoreName='HADDOCK-score',direction='lower-better')],
 sets=[dict(id='champloo_6ibb',receptorChain='B',vhhChain='A',selectedModelId='1'),dict(id='lightdock_original_3p0g',receptorChain='A',vhhChain='B',selectedModelId='1'),dict(id='lightdock_refined_3p0g',receptorChain='A',vhhChain='B',selectedModelId='1')],attempts=[])
for row in csv.DictReader((ROOT/'champloo_data/6IBB_pose_manifest.csv').open()):
 coordinate=bound(ROOT/'champloo_data/extracted'/row['archive_member'].removeprefix('./'),format='mmcif')
 producer=bound(ROOT/'champloo_data/confidence_adapters'/f"{row['pose_id']}.json",jsonPointer='/iptm')
 assert coordinate['sha256']==row['coordinate_sha256'] and producer['sha256']==row['confidence_json_sha256']
 manifest['attempts'].append(dict(id=row['pose_id'],setId='champloo_6ibb',generatorId='chai1',status='generated',reason='',coordinate=coordinate,producerScore=producer))
for kind,generator in [('original','lightdock'),('refined','haddock')]:
 for row in json.loads((ROOT/f'lightdock_data/{kind}/mapped_records.json').read_text()):
  manifest['attempts'].append(dict(id=row['id'],setId=f'lightdock_{kind}_3p0g',generatorId=generator,status='generated',reason='',coordinate=bound(row['coordinate'],format='pdb'),producerScore=bound(row['sourceScore'],jsonPointer='/score')))
assert len(manifest['attempts'])==395
out=ROOT/'score-manifest.json'
out.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(dict(attemptCount=len(manifest['attempts']),manifest=bound(out)),indent=2))
