import hashlib, json, pathlib, tarfile, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent / 'lightdock_data'
SHA = '6fedad53cb7f999233a706ac2090a8fde47fb33b'
FILES = {
 'original/top100.tgz': 'docking/lightdock/membrane/3p0g/top100.tgz',
 'original/rank.list': 'docking/lightdock/membrane/3p0g/lgd_clustered_rank.list',
 'refined/models.tgz': 'refinement/haddock/membrane/3p0g/models.tgz',
 'refined/rank.list': 'refinement/haddock/membrane/3p0g/haddock_rank.list',
 '3p0g_bound.pdb': 'docking/zdock/average/3p0g/3p0g_bound.pdb',
 'README.md': 'README.md',
}
rows=[]
for target, source in FILES.items():
 p=ROOT/target; p.parent.mkdir(parents=True, exist_ok=True)
 url=f'https://raw.githubusercontent.com/lightdock/membrane_docking/{SHA}/{source}'
 if not p.exists():
  with urllib.request.urlopen(url, timeout=120) as r: p.write_bytes(r.read())
 data=p.read_bytes()
 rows.append(dict(path=target,url=url,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data)))
 if p.suffix == '.tgz':
  with tarfile.open(p) as t:
   for m in t.getmembers():
    if not m.isfile(): continue
    pp=pathlib.PurePosixPath(m.name)
    if pp.is_absolute() or '..' in pp.parts: raise ValueError(m.name)
    dest=p.parent/'coordinates'/pp
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_bytes(t.extractfile(m).read())
 print(target,len(data),flush=True)
(ROOT/'download_manifest.json').write_text(json.dumps(dict(repositoryCommit=SHA,files=rows),indent=2)+'\n')
