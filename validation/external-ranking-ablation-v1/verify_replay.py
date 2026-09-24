"""Compare all scoring results, allowing only actual execution timestamps and their hashes."""
import argparse, hashlib, json
from pathlib import Path
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(p.read_text())
def verify(a,b,out):
 ra,rb=load(a/'receipt.json'),load(b/'receipt.json')
 core={p:(a/p).read_bytes()==(b/p).read_bytes() for p in ['manifest.json','features.json','ranks.json','attempts.json']}
 assert all(core.values()),'Scientific core differs'
 assert set(ra['artifactHashes'])==set(rb['artifactHashes'])
 counts={'identicalBytes':0,'timestampMetadataOnly':0}
 for name in ra['artifactHashes']:
  assert sha(a/name)==ra['artifactHashes'][name] and sha(b/name)==rb['artifactHashes'][name]
  if (a/name).read_bytes()==(b/name).read_bytes():counts['identicalBytes']+=1;continue
  x,y=load(a/name),load(b/name)
  if name.endswith('/audit.json'):
   x.pop('generatedAt');y.pop('generatedAt')
  elif name.endswith('/execution.json'):
   for d,base in [(x,a),(y,b)]:
    d['provenance'].pop('generatedAt')
    binding=d['provenance']['executionBindings'][0]
    # The report hash binds the compact JSON string returned by the frozen
    # exporter, whereas audit.json is pretty-printed. Both are timestamped.
    assert len(binding.pop('reportSha256'))==64
  else:raise AssertionError('Unexpected changed file: '+name)
  assert x==y,'Non-timestamp execution or scientific change: '+name
  counts['timestampMetadataOnly']+=1
 for d in (ra,rb):d.pop('artifactHashes')
 assert ra==rb,'Receipt identity differs beyond timestamped artifact hashes'
 receipt=dict(status='PASS',scoredCount=ra['scoredCount'],identicalScientificCoreFiles=core,
  perPoseComparison=counts,sourceReceiptSha256=sha(a/'receipt.json'),replayReceiptSha256=sha(b/'receipt.json'),
  allowedDifferences=['audit.generatedAt','execution.provenance.generatedAt','execution.provenance.executionBindings[0].reportSha256','receipt.artifactHashes for those timestamped files'])
 out.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('original',type=Path);p.add_argument('replay',type=Path);p.add_argument('output',type=Path);a=p.parse_args();verify(a.original,a.replay,a.output)
