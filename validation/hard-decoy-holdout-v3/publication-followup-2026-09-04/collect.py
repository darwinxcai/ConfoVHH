#!/usr/bin/env python3
"""Capture and replay metadata-only C.5 citation-gap follow-up; no coordinates."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = Path('validation/hard-decoy-holdout-v3')
INPUTS = [
    BASE/'entry-metadata-snapshot-2026-08-29/entries.jsonl',
    BASE/'gpcrdb-complement-metadata-2026-09-04/entries.jsonl',
    BASE/'gpcrdb-complement-screen-2026-09-04/entity-screens.jsonl',
    BASE/'gpcrdb-complement-priority-review-2026-09-04/source-reviews.json',
]
def sha(data): return hashlib.sha256(data).hexdigest()
def dump(data): return json.dumps(data, indent=2, ensure_ascii=False)+'\n'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def rows(path): return [json.loads(line) for line in path.read_text().splitlines()]
def immutable(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode() if isinstance(content, str) else content
    if path.exists(): assert path.read_bytes() == data, f'Immutable file changed: {path}'
    else: path.write_bytes(data)

def plan():
    historical, complement = [rows(ROOT/p) for p in INPUTS[:2]]
    assert len(historical)==287 and len(complement)==1426
    assert not ({r['pdbId'] for r in historical} & {r['pdbId'] for r in complement})
    screens = {}
    for r in rows(ROOT/INPUTS[2]): screens.setdefault(r['pdbId'], []).append(r)
    gaps=[]
    for route, source, records in [('HISTORICAL',INPUTS[0],historical),('COMPLEMENT',INPUTS[1],complement)]:
        for r in records:
            citation=r['primaryCitation']
            missing=[key for key in ['doi','pmid'] if not citation.get(key)]
            if not missing: continue
            signals=[]
            for e in r['polymerEntities']:
                m=e['metadataSignals']
                lexical=bool(re.search(r'(?i)antibod|nanobody|nano.body|scfv|svfv|fab|vhh|camelid',e['description']))
                numbered=[s for s in screens.get(r['pdbId'],[]) if s['entityId']==e['entityId']]
                reason=[]
                if m.get('vhhLikeCandidate'): reason.append('FROZEN_VHH_LIKE_METADATA_SIGNAL')
                if lexical: reason.append('ANTIBODY_DESCRIPTOR_SIGNAL')
                if any(s['numberedHeavyDomainCallCount'] for s in numbered): reason.append('NUMBERED_HEAVY_DOMAIN_SIGNAL')
                if any(s['referenceMatchCount'] for s in numbered): reason.append('ANTIBODY_REFERENCE_SEQUENCE_MATCH_SIGNAL')
                if reason: signals.append({'entityId':e['entityId'],'rcsbId':e['rcsbId'],'description':e['description'],'sequenceSha256':e['sequenceSha256'],'signalReasons':reason})
            gaps.append({'pdbId':r['pdbId'],'route':route,'frozenMetadataPath':str(source),'frozenCitation':citation,'missingFields':missing,'antibodyEvidencePriority':bool(signals),'candidateEntitySignals':signals,'frozenTitle':r['title'],'frozenGpcrdbPublication':(r.get('gpcrdb') or {}).get('publication'),'fullFrozenPolymerInventoryRef':{'path':str(source),'pdbId':r['pdbId'],'polymerEntityCount':len(r['polymerEntities']),'polymerSequenceHashes':{e['rcsbId']:e['sequenceSha256'] for e in r['polymerEntities']}}})
    gaps.sort(key=lambda r:(not r['antibodyEvidencePriority'],r['pdbId']))
    requests=[]
    ids=sorted(r['pdbId'] for r in gaps)
    for start in range(0,len(ids),20):
        group=ids[start:start+20]
        query='query { entries(entry_ids: '+json.dumps(group)+') { rcsb_id rcsb_primary_citation { title pdbx_database_id_DOI pdbx_database_id_PubMed year journal_abbrev journal_volume page_first page_last rcsb_authors } } }'
        url='https://data.rcsb.org/graphql?'+urllib.parse.urlencode({'query':query})
        for repeat in [1,2]: requests.append({'requestId':f'rcsb-{start//20+1:02d}-repeat-{repeat}','kind':'RCSB_PRIMARY_CITATION_ONLY','pdbIds':group,'repeat':repeat,'method':'GET','url':url})
    for r in gaps:
        query='"'+r['pdbId']+'"'
        url='https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+urllib.parse.urlencode({'query':query,'format':'json','resultType':'lite','pageSize':1000,'cursorMark':'*'})
        requests.append({'requestId':'pdb-'+r['pdbId'],'kind':'EUROPE_PMC_EXACT_QUOTED_PDB_QUERY','pdbIds':[r['pdbId']],'query':query,'method':'GET','url':url})
    dois=sorted({r['frozenCitation']['doi'] for r in gaps if r['frozenCitation']['doi']})
    for i,doi in enumerate(dois,1):
        query='DOI:"'+doi+'"'
        url='https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+urllib.parse.urlencode({'query':query,'format':'json','resultType':'lite','pageSize':1000,'cursorMark':'*'})
        requests.append({'requestId':f'doi-{i:02d}','kind':'EUROPE_PMC_EXISTING_DOI_QUERY','pdbIds':sorted(r['pdbId'] for r in gaps if r['frozenCitation']['doi']==doi),'query':query,'method':'GET','url':url})
    return {'schemaVersion':'1.0.0','studyId':'confovhh-hard-decoy-holdout-v3','discoveryRoute':'C.5_MISSING_PRIMARY_CITATION_FOLLOWUP','reviewDate':'2026-09-04','inputDigests':{str(p):sha((ROOT/p).read_bytes()) for p in INPUTS},'historicalEntriesInspected':len(historical),'complementEntriesInspected':len(complement),'citationGapDefinition':'At least one of frozen primaryCitation.doi or primaryCitation.pmid is absent.','citationGaps':gaps,'requests':requests,'knownPositiveControl':{'pdbId':'8HN1','doi':'10.1038/s42003-025-08405-0','evidencePath':str(INPUTS[3]),'interpretation':'Previously source-linked exact accession; not a new source adjudication in this route.'},'antibodySignalCaveat':'Signals set query priority; absence of a signal is not antibody absence evidence.','metadataOnlyMatchesAreSourceAdjudications':False,'broaderDiscoveryComplete':False,'targetFreezePermitted':False}

def capture(request):
    raw=HERE/'raw'/f'{request["requestId"]}.json'
    cap=HERE/'captures'/f'{request["requestId"]}.json'
    if cap.exists():
        c=json.loads(cap.read_text()); assert c['request']==request
        if c.get('rawFile'): assert sha((HERE/c['rawFile']).read_bytes())==c['sha256']
        return c
    c={'request':request,'startedUtc':now(),'status':None,'rawFile':None}
    try:
        req=urllib.request.Request(request['url'],headers={'Accept':'application/json','User-Agent':'ConfoVHH-Census-Metadata-Audit/3.0'})
        with urllib.request.urlopen(req,timeout=40) as response:
            data=response.read(16*1024*1024+1)
            assert len(data)<=16*1024*1024,'Response exceeds 16 MiB cap'
            c.update(status=response.status,finalUrl=response.url,contentType=response.headers.get('content-type'),etag=response.headers.get('etag'),lastModified=response.headers.get('last-modified'))
        immutable(raw,data)
        c.update(rawFile=str(raw.relative_to(HERE)),sha256=sha(data),bytes=len(data))
        assert c['status']==200 and c['finalUrl']==request['url']
        assert 'json' in (c['contentType'] or '').lower()
        obj=json.loads(data)
        if request['kind']=='RCSB_PRIMARY_CITATION_ONLY':
            assert not obj.get('errors') and isinstance(obj.get('data',{}).get('entries'),list)
            assert set(e['rcsb_id'] for e in obj['data']['entries'] if e)==set(request['pdbIds'])
        else:
            assert obj['request']['queryString']==request['query']
            assert obj['request']['pageSize']==1000 and obj['request']['resultType']=='lite'
            assert isinstance(obj['hitCount'],int) and isinstance(obj['resultList']['result'],list)
            c.update(reportedHitCount=obj['hitCount'],retrievedRecordCount=len(obj['resultList']['result']),returnedQueryPaginationComplete=len(obj['resultList']['result'])==obj['hitCount'])
        c['validated']=True
    except Exception as e:
        c.update(validated=False,error=f'{type(e).__name__}: {e}')
    c['completedUtc']=now();immutable(cap,dump(c));return c

def verify():
    expected=plan(); actual=json.loads((HERE/'collection-plan.json').read_text());assert actual==expected
    assert json.loads((HERE/'capture-manifest.json').read_text())['collectorSha256']==sha(Path(__file__).read_bytes())
    results=[]
    for req in actual['requests']:
        cap=json.loads((HERE/'captures'/f'{req["requestId"]}.json').read_text());assert cap['request']==req
        if cap.get('rawFile'):
            data=(HERE/cap['rawFile']).read_bytes();assert len(data)==cap['bytes'] and sha(data)==cap['sha256']
        results.append(cap)
    return {'citationGapEntries':len(expected['citationGaps']),'antibodyPriorityEntries':sum(r['antibodyEvidencePriority'] for r in expected['citationGaps']),'plannedRequests':len(results),'successfulValidatedRequests':sum(c['validated'] for c in results),'failedRequests':[c['request']['requestId'] for c in results if not c['validated']]}

if __name__=='__main__':
    assert len(sys.argv)==2 and sys.argv[1] in ['collect','verify']
    if sys.argv[1]=='collect':
        p=plan();immutable(HERE/'collection-plan.json',dump(p))
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            captured=list(pool.map(capture,p['requests']))
        immutable(HERE/'capture-manifest.json',dump({'collectorSha256':sha(Path(__file__).read_bytes()),'completedUtc':now(),'captures':[{'requestId':c['request']['requestId'],'path':f'captures/{c["request"]["requestId"]}.json','sha256':sha((HERE/'captures'/f'{c["request"]["requestId"]}.json').read_bytes())} for c in captured]}))
    print(dump(verify()))
