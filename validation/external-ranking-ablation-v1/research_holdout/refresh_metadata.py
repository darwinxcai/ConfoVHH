import urllib.request,urllib.parse,json,pathlib,datetime,hashlib,concurrent.futures
out=pathlib.Path(__file__).resolve().parent
terms=['nanobody','VHH','sybody','megabody','single-domain antibody','single domain antibody']
q={'query':{'type':'group','logical_operator':'and','nodes':[{'type':'group','logical_operator':'or','nodes':[{'type':'terminal','service':'full_text','parameters':{'value':term}} for term in terms]},{'type':'terminal','service':'text','parameters':{'attribute':'rcsb_accession_info.initial_release_date','operator':'greater','value':'2026-09-10'}},{'type':'terminal','service':'text','parameters':{'attribute':'rcsb_accession_info.initial_release_date','operator':'less_or_equal','value':'2026-09-24'}}]},'return_type':'entry','request_options':{'return_all_hits':True}}
def get(url,name):
 with urllib.request.urlopen(url,timeout=30) as r: raw=r.read()
 (out/name).write_bytes(raw)
 return json.loads(raw)
(out/'query.json').write_text(json.dumps(q,indent=2)+'\n')
u='https://search.rcsb.org/rcsbsearch/v2/query?json='+urllib.parse.quote(json.dumps(q))
d=get(u,'query-response.json')
ids=sorted(x['identifier'] for x in d.get('result_set',[]))
def entry(p):
 x=get('https://data.rcsb.org/rest/v1/core/entry/'+p,p+'-entry.json')
 return {'pdbId':p,'title':x.get('struct',{}).get('title'),'releaseDate':x.get('rcsb_accession_info',{}).get('initial_release_date'),'resolution':x.get('rcsb_entry_info',{}).get('resolution_combined'),'polymerIds':x.get('rcsb_entry_container_identifiers',{}).get('polymer_entity_ids'),'url':'https://www.rcsb.org/structure/'+p}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex: rows=list(ex.map(entry,ids))
poly=[]
for p in ['9U40','9U43']:
 for i in range(1,7):
  x=get(f'https://data.rcsb.org/rest/v1/core/polymer_entity/{p}/{i}',f'{p}-entity-{i}.json')
  ids=x.get('rcsb_polymer_entity_container_identifiers',{})
  poly.append({'pdbId':p,'entity':str(i),'description':x.get('rcsb_polymer_entity',{}).get('pdbx_description'),'length':x.get('entity_poly',{}).get('rcsb_sample_sequence_length'),'authChains':ids.get('auth_asym_ids'),'labelChains':ids.get('asym_ids'),'uniprotIds':ids.get('uniprot_ids')})
summary={'retrievedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'RCSB full-text union; initial release after 2026-09-10 through 2026-09-24; not sequence-complete discovery','metadataOnly':True,'coordinatesOpened':False,'scorerRun':False,'totalCount':d.get('total_count',0),'entries':rows,'newGpcrPolymerMetadata':poly}
(out/'delta-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
