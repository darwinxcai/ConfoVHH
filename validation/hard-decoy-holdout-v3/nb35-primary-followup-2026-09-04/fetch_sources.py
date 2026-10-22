#!/usr/bin/env python3
"""Capture specified public primary-source routes without emitting source text."""
import concurrent.futures, datetime, hashlib, json, pathlib, sys, urllib.error, urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
SOURCES=json.loads((ROOT/'source-routes.json').read_text())
def capture(k):
 u=SOURCES[k];p=ROOT/'raw'/f'{k}.response';m=ROOT/'raw'/f'{k}.metadata.json'
 if p.exists() or m.exists(): raise RuntimeError('Refusing to overwrite '+k)
 (ROOT/'raw').mkdir(exist_ok=True)
 metadata={'key':k,'url':u,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  try:r=urllib.request.urlopen(u,timeout=45)
  except urllib.error.HTTPError as e:r=e
  body=r.read();p.write_bytes(body);metadata.update({'finalUrl':r.url,'httpStatus':r.status,'bodySha256':hashlib.sha256(body).hexdigest(),'path':str(p.relative_to(ROOT)),'contentType':r.headers.get('content-type'),'size':len(body)})
 except Exception as e: metadata.update({'transportError':str(e),'httpStatus':None})
 m.write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata))
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(capture,sys.argv[1:] or SOURCES))
