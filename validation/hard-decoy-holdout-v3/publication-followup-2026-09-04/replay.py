#!/usr/bin/env python3
"""Rebuild citation follow-up from archived requests and explicit source notes."""
from collections import Counter
import html
import json
from pathlib import Path
import re
import sys
import urllib.parse
sys.dont_write_bytecode = True
import collect

HERE=Path(__file__).resolve().parent
def title_key(value):
    text=re.sub(r'<[^>]+>','',html.unescape(value or '')).casefold()
    text=text.replace('β','beta').replace('α','alpha').replace('γ','gamma')
    return ''.join(c for c in text if c.isalnum())
def norm(c):
    return {'doi':str(c.get('pdbx_database_id_DOI') or '').lower() or None,
            'pmid':str(c.get('pdbx_database_id_PubMed') or '') or None,
            'title':c.get('title') or None}
def main(write=False):
    capture_summary=collect.verify()
    assert not capture_summary['failedRequests'], 'Base collection has unvalidated requests'
    plan=json.loads((HERE/'collection-plan.json').read_text())
    manifest=json.loads((HERE/'capture-manifest.json').read_text())
    assert {c['requestId'] for c in manifest['captures']}=={r['requestId'] for r in plan['requests']}
    for capture in manifest['captures']:
        assert collect.sha((HERE/capture['path']).read_bytes())==capture['sha256'],'Capture envelope differs from manifest'
    extra=json.loads((HERE/'adaptive-requests.json').read_text())
    notes=json.loads((HERE/'source-notes.json').read_text())
    exposure=json.loads((HERE/'exposure-caveat.json').read_text())
    assert exposure['formalExposureClearanceComplete'] is False and exposure['targetFreezePermitted'] is False
    assert notes['boundaries']=={'newBinderRoleAdjudications':0,'newEntryDispositions':0,'broaderDiscoveryComplete':False,'targetFreezePermitted':False}
    for name in ['7XM6','7YP7']:
        cap=json.loads((HERE/'captures'/f'holdings-{name}.json').read_text())
        data=(HERE/cap['rawFile']).read_bytes()
        assert collect.sha(data)==cap['sha256'] and len(data)==cap['bytes']
        assert cap['url']==f'https://data.rcsb.org/rest/v1/holdings/status/{name}' and cap['status']==200
        assert cap['method']=='GET' and cap['finalUrl']==cap['url'] and 'json' in cap['contentType'].lower()
        assert json.loads(data)['rcsb_id']==name
    for record in json.loads((HERE/'supporting-bibliography-manifest.json').read_text()):
        data=(HERE/record['rawFile']).read_bytes()
        assert collect.sha(data)==record['sha256']
        response=json.loads(data)
        assert response['request']==record['requestEcho']
        assert response['hitCount']==record['reportedHitCount']
        assert len(response['resultList']['result'])==record['retrievedRecordCount']
    requests=plan['requests']+extra
    assert len({r['requestId'] for r in requests})==len(requests),'Duplicate request identifiers'
    candidates=[]; by_query={}; current={}; current_full={}; captures={}
    for request in requests:
        rid=request['requestId'];capture=json.loads((HERE/'captures'/f'{rid}.json').read_text())
        assert capture['request']==request and capture['validated']
        assert capture['status']==200 and capture['finalUrl']==request['url']
        assert request['method']=='GET' and 'json' in capture['contentType'].lower()
        assert capture['rawFile']==f'raw/{rid}.json'
        data=(HERE/capture['rawFile']).read_bytes()
        assert collect.sha(data)==capture['sha256'] and len(data)==capture['bytes']
        response=json.loads(data);captures[rid]=capture
        if request['kind']=='RCSB_PRIMARY_CITATION_ONLY':
            assert not response.get('errors')
            entries=response['data']['entries']
            assert set(e['rcsb_id'] for e in entries)==set(request['pdbIds'])
            assert len(entries)==len(request['pdbIds'])
            for e in entries:
                assert set(e)=={'rcsb_id','rcsb_primary_citation'}
                assert set(e['rcsb_primary_citation']) <= {'title','pdbx_database_id_DOI','pdbx_database_id_PubMed','year','journal_abbrev','journal_volume','page_first','page_last','rcsb_authors'}
                current.setdefault(e['rcsb_id'],[]).append({'requestId':rid,'citation':norm(e['rcsb_primary_citation']),'rawFile':capture['rawFile'],'rawSha256':capture['sha256']})
                current_full.setdefault(e['rcsb_id'],[]).append(e['rcsb_primary_citation'])
        else:
            url=urllib.parse.urlsplit(request['url'])
            assert url.scheme=='https' and url.netloc=='www.ebi.ac.uk' and url.path=='/europepmc/webservices/rest/search'
            assert urllib.parse.parse_qs(url.query)=={'query':[request['query']],'format':['json'],'resultType':['lite'],'pageSize':['1000'],'cursorMark':['*']}
            assert response['request']['queryString']==request['query']
            assert response['request']['pageSize']==1000 and response['request']['resultType']=='lite'
            # These captures echo the URL-encoded initial cursor as "%2A".
            assert response['request']['cursorMark'] in ['*','%2A'] and response['request']['synonym'] is False and response['request']['sort']=='','Bibliography query options differ'
            results=response['resultList']['result']
            assert len(results)==response['hitCount'],'Unfinished bibliography query pagination'
            by_query[rid]=results
            for r in results:
                candidates.append({'queryId':rid,'query':request['query'],'pdbIds':request['pdbIds'],'source':r.get('source'),'id':r.get('id'),'pmid':r.get('pmid'),'pmcid':r.get('pmcid'),'doi':r.get('doi'),'title':r.get('title'),'firstPublicationDate':r.get('firstPublicationDate'),'publicationType':r.get('pubType'),'matchStrength':'INDEX_QUERY_HIT_NOT_EXACT_ACCESSION_VERIFICATION','sourceRoleAdjudication':False,'rawFile':capture['rawFile'],'rawSha256':capture['sha256']})
    source_map={r['pdbId']:r for r in notes['reviews']}
    assert len(source_map)==len(notes['reviews'])
    assert set(source_map)<={r['pdbId'] for r in plan['citationGaps']}
    for note in notes['reviews']:
        assert note['candidateDispositionChanged'] is False
        citation=note.get('candidateCitation')
        if citation and citation.get('sourceTextSha256'):
            assert re.fullmatch('[0-9a-f]{64}',citation['sourceTextSha256'])
        prior=note.get('priorSourceReviewRef')
        if prior:
            assert collect.sha((collect.ROOT/prior['path']).read_bytes())==prior['sha256'],'Prior source review hash differs'
        if note.get('currentHoldingsFollowup'):
            for name in ['7XM6','7YP7']:
                record=note['currentHoldingsFollowup'][name]
                data=(HERE/record['path']).read_bytes()
                assert collect.sha(data)==record['sha256']
                holdings=json.loads(data)['rcsb_repository_holdings_combined']
                assert holdings['status']==record['status'] and holdings['status_code']==record['statusCode']
    followup=[]
    for gap in plan['citationGaps']:
        pid=gap['pdbId']; rc=current[pid]
        assert len(rc)==2
        assert rc[0]['citation']==rc[1]['citation'],f'Current citation metadata repeats disagree: {pid}'
        assert current_full[pid][0]==current_full[pid][1],f'Full citation fields differ between repeats: {pid}'
        known=gap['frozenCitation']; proposed={}; evidence=[]; title_checks=[]
        live=rc[0]['citation']
        for field in gap['missingFields']:
            if live[field]: proposed[field]=live[field];evidence.append({'kind':'CURRENT_RCSB_METADATA_ONLY','field':field})
        reqs=[r for r in requests if r['kind']=='EUROPE_PMC_EXISTING_DOI_QUERY' and pid in r['pdbIds']]
        for req in reqs:
            exact_doi=[r for r in by_query[req['requestId']] if str(r.get('doi','')).lower()==known['doi'].lower()]
            for r in exact_doi:
                title_checks.append({'queryId':req['requestId'],'doi':known['doi'],'frozenTitle':known['title'],'bibliographicTitle':r.get('title'),'normalization':'HTML entities/tags, case, alpha/beta/gamma spelling and non-alphanumeric punctuation normalized only','titleNormalizedExactMatch':title_key(known['title'])==title_key(r.get('title')),'bibliographicSource':r.get('source'),'bibliographicId':r.get('id')})
            matching=[r for r in exact_doi if r.get('pmid') and title_key(known['title'])==title_key(r.get('title'))]
            pmids={str(r['pmid']) for r in matching}
            if len(pmids)==1 and 'pmid' in gap['missingFields']:
                proposed['pmid']=next(iter(pmids));evidence.append({'kind':'EXACT_EXISTING_DOI_BIBLIOGRAPHIC_PMID_MATCH','queryId':req['requestId'],'matchingBibliographicRecords':[{'source':r.get('source'),'id':r.get('id'),'pmid':r.get('pmid'),'pmcid':r.get('pmcid'),'doi':r.get('doi')} for r in matching]})
        note=source_map.get(pid)
        if note and note['exactPdbDepositionVerified']:
            assert pid in note['exactPdbIdsInRelevantDepositionStatement']
            citation=note['candidateCitation'];assert citation and citation['doi']
            assert citation.get('sourceTextSha256') or note.get('priorSourceReviewRef')
            for field in gap['missingFields']:
                if citation.get(field): proposed[field]=citation[field]
            evidence.append({'kind':'PREVIOUSLY_VERIFIED_PRIMARY_DEPOSITION_CONTROL' if note.get('knownPositiveControl') else 'ORIGINAL_ARTICLE_EXACT_DEPOSITION_STATEMENT','sourceNotePdbId':pid})
        missing_after=[field for field in gap['missingFields'] if not proposed.get(field)]
        status=('EXACT_PRIMARY_DEPOSITION_LINK_RECOVERED' if note and note['exactPdbDepositionVerified'] else 'BIBLIOGRAPHIC_IDENTIFIER_RECOVERED_ONLY' if proposed else 'NO_MISSING_CITATION_FIELD_RECOVERED')
        followup.append({**gap,'currentRcsbCitationCaptures':rc,'currentRcsbCitationRepeatsAgree':True,'currentRcsbNormalizedCitationChanged':live!={k:known.get(k) for k in ['doi','pmid','title']},'existingDoiTitleCrosschecks':title_checks,'bibliographyQueryIds':[r['requestId'] for r in requests if r['kind']!='RCSB_PRIMARY_CITATION_ONLY' and pid in r['pdbIds']],'followupStatus':status,'proposedMissingIdentifierOverlay':proposed,'remainingMissingFields':missing_after,'citationEvidence':evidence,'primarySourceNoteRef':{'file':'source-notes.json','pdbId':pid} if note else None,'sourceRoleAdjudicationComplete':False,'entryDispositionChanged':False,'formalLeakageGraphAuthority':False,'formalComponentCountAuthority':False,'targetFreezePermitted':False})
    followup.sort(key=lambda r:r['pdbId'])
    summary={'schemaVersion':'1.0.0','studyId':plan['studyId'],'route':plan['discoveryRoute'],'frozenEntriesInspected':1713,'historicalCitationGapEntries':sum(r['route']=='HISTORICAL' for r in followup),'complementCitationGapEntries':sum(r['route']=='COMPLEMENT' for r in followup),'citationGapEntries':len(followup),'antibodyEvidencePriorityEntries':sum(r['antibodyEvidencePriority'] for r in followup),'missingDoiEntries':sum('doi' in r['missingFields'] for r in followup),'missingPmidEntries':sum('pmid' in r['missingFields'] for r in followup),'currentRcsbCitationEntriesCapturedTwice':len(current),'currentRcsbCitationChangedEntries':sum(r['currentRcsbNormalizedCitationChanged'] for r in followup),'bibliographyRequestsCaptured':len(requests)-6,'allReturnedBibliographyQueryPagesCaptured':True,'bibliographyHitRows':len(candidates),'followupStatusCounts':dict(sorted(Counter(r['followupStatus'] for r in followup).items())),'entriesWithAllMissingIdentifierFieldsRecovered':sum(not r['remainingMissingFields'] for r in followup),'entriesWithIdentifierFieldsStillMissing':sum(bool(r['remainingMissingFields']) for r in followup),'newExactPrimaryDepositionLinks':sum(r.get('exactPdbDepositionVerified',False) and not r.get('knownPositiveControl',False) for r in notes['reviews']),'knownPositiveControls':sum(r.get('knownPositiveControl',False) for r in notes['reviews']),'newEntryRoleAdjudications':0,'newEntryDispositions':0,'sourceEligibilityReviewComplete':False,'broaderDiscoveryComplete':False,'incidentalContactTextReturnedInSearchSnippet':True,'exposureCaveatPath':'exposure-caveat.json','nativeCoordinatesRequestedOrInspected':False,'structureImagesRequestedOrInspected':False,'holdoutLabelsAccessed':False,'formalExposureClearanceComplete':False,'targetFreezePermitted':False}
    outputs={'followup.jsonl':''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in followup),'bibliography-hits.jsonl':''.join(json.dumps(r,ensure_ascii=False,sort_keys=True)+'\n' for r in candidates),'summary.json':collect.dump(summary)}
    for name,data in outputs.items():
        if write:(HERE/name).write_text(data)
        else:assert (HERE/name).read_text()==data,f'Derived output differs: {name}'
    return summary

if __name__=='__main__':
    assert len(sys.argv)==2 and sys.argv[1] in ['build','verify']
    print(collect.dump(main(sys.argv[1]=='build')))
