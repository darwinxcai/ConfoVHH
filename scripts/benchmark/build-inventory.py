#!/usr/bin/env python3
"""Reconcile retained metadata and exposure records; never read candidate outcomes."""
import csv
import hashlib
import json
from pathlib import Path
import re
import io
from collections import Counter

ROOT=Path(__file__).resolve().parents[2]
V3=Path('validation/hard-decoy-holdout-v3')
V2=Path('validation/hard-decoy-holdout-v2/prelabel-census')
OUT=ROOT/'validation/prospective-benchmark-v1/inventory'
SOURCES={}


def read(path):
    p=ROOT/path;data=p.read_bytes();SOURCES[str(path)]=dict(path=str(path),bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
    return data.decode()


def js(path):return json.loads(read(path))
def jl(path):return [json.loads(line) for line in read(path).splitlines() if line.strip()]
def save(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')


class Groups:
    def __init__(self,ids):self.parent={x:x for x in ids}
    def find(self,x):
        self.parent.setdefault(x,x)
        if self.parent[x]!=x:self.parent[x]=self.find(self.parent[x])
        return self.parent[x]
    def join(self,ids):
        ids=sorted(set(ids))
        for x in ids[1:]:self.parent[self.find(x)]=self.find(ids[0])


def main():
    OUT.mkdir(parents=True,exist_ok=False)
    seed=jl(V3/'disposition-seed-2026-08-29/entry-dispositions.jsonl')
    overlay=jl(V3/'review-disposition-integration-2026-09-07/contract-dispositions.jsonl')
    backlog=jl(V3/'review-disposition-integration-2026-09-07/normalization-backlog.jsonl')
    registry=js(V2/'development-registry.json')
    dev={r['pdbId']:r for r in registry['developmentGpcrVhhStructures']}
    legacy_path=Path('validation/gpcr-paper-development-2026-09-04/recovered-availability/model-eligibility.csv')
    legacy_counts=Counter((r['reference'],r['coordinateAvailability'],r['officialScoringReady']) for r in csv.DictReader(io.StringIO(read(legacy_path))))
    for id,availability,ready in legacy_counts:
        if id not in dev:dev[id]=dict(pdbId=id,receptor=None,roles=['legacy-development-reference-metadata; numeric outcome columns not inspected'])
    parser_oracles=set(registry['assemblyOnlyParserOracles'])
    nodes=jl(V3/'exact-evidence-pregraph-2026-08-29/candidate-nodes.jsonl')+jl(V3/'exact-evidence-pregraph-2026-08-29/development-nodes.jsonl')
    profiles=jl(V3/'receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl')+jl(V3/'receptor-tm-pregraph-2026-08-30/development-receptor-profiles.jsonl')
    provisional=jl(V2/'target-census.jsonl')
    direct_impact=jl(V3/'direct-signal-salvage-bound-2026-09-04/provisional-census-impact.jsonl')
    curated=set(dev)|parser_oracles|{r['pdbId'] for r in nodes+overlay+backlog+provisional}
    exposures={}
    paths=[V3/p for p in [
        'review-exposure-addendum-2026-09-06/exposure-addendum.json',
        'review-exposure-addendum-2026-09-07/exposure-addendum.json',
        'annotation-priority-review-2026-09-04/exposure-caveat.json',
        'annotation-additional-priority-review-2026-09-04/incidental-prose-exposure.json',
        'publication-followup-2026-09-04/exposure-caveat.json',
        'global-text-priority-review-2026-09-04/exposure-scope.json',
        'mglyr-known-lineage-2026-09-08/source-navigation-exposure.json',
        'mglyr-construct-followup-2026-09-04/navigation-exposure-caveat.json',
        'mglyr-deposition-construct-2026-09-08/README.md',
        'mglyr-known-lineage-2026-09-08/lineage.json']]
    def gather(value,key=''):
        ids=set()
        if isinstance(value,dict):
            for k,v in value.items():ids |= gather(v,k)
        elif isinstance(value,list):
            for v in value:ids |= gather(v,key)
        elif isinstance(value,str) and ('pdb' in key.lower() or 'affected' in key.lower() or 'entries' in key.lower()):
            if re.fullmatch(r'[0-9][A-Z0-9]{3}',value):ids.add(value)
        return ids
    for path in paths:
        text=read(path)
        ids=gather(json.loads(text)) if path.suffix=='.json' else set()
        if 'mglyr' in str(path):ids |= {'9VOR','9VOS'}
        for id in ids:exposures.setdefault(id,[]).append(str(path))
    curated |= set(exposures)
    groups=Groups(curated);links=[];receptor_groups={};vhh_groups={}
    for rel,kind in [('receptor-tm-pregraph-2026-08-30/primary-components.jsonl','receptor'),
                     ('vhh-sequence-pregraph-2026-08-29/threshold-pregraph-components.jsonl','nanobody')]:
        for c in jl(V3/rel):
            ids=sorted({n.split(':')[1] for n in c['nodeIds']})
            groups.join(ids)
            for id in ids:(receptor_groups if kind=='receptor' else vhh_groups)[id]=c['componentId']
            if len(ids)>1:links.append(dict(kind=kind,members=ids,source=str(V3/rel),sourceComponentId=c['componentId'],authority='possible-relatedness-block-only'))
    # Same provisional receptor family and explicit known lineages cannot create extra groups.
    families={}
    for p in provisional:families.setdefault(p['provisionalGroupId'],[]).append(p['pdbId'])
    families['GPR158']=['9VOR','9VOS']
    families['MGLU']=sorted(set(families.get('MGLU',[]))|{'6N4X','6N4Y','6N50','6N51','6N52'})
    families['LGR4']=sorted(set(families.get('LGR4',[]))|{'9S37','8XT9','8XUM','9KGK','9KHH','9UOK'})
    for f,ids in families.items():
        groups.join(ids);links.append(dict(kind='provisional-family',members=ids,label=f,source=str(V2/'target-census.jsonl'),
            exposureFamilySources=[str(path) for path in paths if
              (f=='MGLU' and 'global-text-priority' in str(path)) or
              (f=='LGR4' and 'annotation-priority' in str(path)) or
              (f=='GPR158' and 'mglyr-deposition' in str(path))],authority='grouping-not-eligibility'))
    for r in registry['knownDevelopmentVhhLineages']:
        groups.join(r['pdbIds']);links.append(dict(kind='known-development-lineage',members=r['pdbIds'],label=r['id'],source=str(V2/'development-registry.json'),authority='development-relatedness'))
    # Retained GPCRdb receptor-family prefix: three levels, a conservative family veto.
    by_family={}
    for p in profiles:
        if p.get('family'):by_family.setdefault('_'.join(p['family'].split('_')[:3]),[]).append(p['pdbId'])
    for family,ids in by_family.items():
        groups.join(ids)
        if len(set(ids))>1:links.append(dict(kind='gpcrdb-family-prefix-three-levels',members=sorted(set(ids)),label=family,source=str(V3/'receptor-tm-pregraph-2026-08-30/candidate-receptor-profiles.jsonl'),authority='conservative-block-not-no-edge-proof'))
    components={}
    for id in sorted(curated):components.setdefault(groups.find(id),[]).append(id)
    membership={};group_rows=[]
    for members in components.values():
        id='related-'+hashlib.sha256('\n'.join(members).encode()).hexdigest()[:16]
        for p in members:membership[p]=id
        group_rows.append(dict(id=id,members=members,developmentMembers=sorted(set(members)&set(dev)),
             exposureReviewMembers=sorted(set(members)&set(exposures)),certifiedIndependent=False,
             status='PROVISIONAL_RELATEDNESS_COMPONENT_NOT_AN_INDEPENDENT_TARGET_COUNT'))
    group_map={g['id']:g for g in group_rows};node_map={r['pdbId']:r for r in nodes};profile_map={r['pdbId']:r for r in profiles}
    seed_map={r['pdbId']:r for r in seed};overlay_map={r['pdbId']:r for r in overlay};provisional_map={r['pdbId']:r for r in provisional}
    rows=[]
    for id in sorted(curated):
        node=node_map.get(id,{});p=provisional_map.get(id,{});profile=profile_map.get(id,{})
        group=group_map[membership[id]];prior=overlay_map.get(id,{}).get('dispositionCode',seed_map.get(id,{}).get('dispositionCode'))
        reasons=[]
        if id in dev:reasons.append('EXCLUDE_PRIOR_IMPLEMENTATION_OR_NATIVE_DEVELOPMENT_EXPOSURE')
        if id in parser_oracles:reasons.append('EXCLUDE_PRIOR_ASSEMBLY_PARSER_CONTROL')
        if prior and prior.startswith('EXCLUDE_'):reasons.append(prior)
        if id in exposures:reasons.append('BLOCK_PRIOR_STRUCTURAL_OR_PREDICTION_PROSE_EXPOSURE_REVIEW')
        if group['developmentMembers'] and id not in dev:reasons.append('BLOCK_POSSIBLE_RECEPTOR_OR_NANOBODY_CONNECTION_TO_DEVELOPMENT')
        if group['exposureReviewMembers'] and id not in exposures:reasons.append('BLOCK_RELATED_SOURCE_FAMILY_EXPOSURE_REVIEW')
        if id=='7E6U':reasons.append('EXCLUDE_RESOLUTION_6A_ABOVE_PRESPECIFIED_4A_GATE')
        if id=='8QJ2':reasons.append('BLOCK_ENGINEERED_ADRB2_GRAFT_RELATED_TO_DEVELOPMENT')
        if any(r['pdbId']==id and r['v3SurvivalUpperBound']==0 for r in direct_impact):
            reasons.append('EXCLUDE_DOCUMENTED_PRIMARY_RECEPTOR_EDGE_TO_DEVELOPMENT')
        if not any(r.startswith('EXCLUDE_') for r in reasons):
            reasons+=['BLOCK_DIRECT_RECEPTOR_VHH_ROLE_OR_CONSTRUCT_CERTIFICATION_INCOMPLETE',
                      'BLOCK_COMPLETE_PARENT_FAMILY_AND_NO_EDGE_REVIEW_MISSING',
                      'BLOCK_GENERAL_BENCHMARK_INPUTS_AND_REFERENCE_FEASIBILITY_NOT_LOCKED']
        rows.append(dict(pdbId=id,receptor=dev.get(id,{}).get('receptor',p.get('receptor',{}).get('name',node.get('receptor',{}).get('description'))),
              nanobody=p.get('vhh',{}).get('name'),receptorFamily=profile.get('family'),
              receptorSequenceGroup=receptor_groups.get(id),nanobodySequenceGroup=vhh_groups.get(id),
              relatednessGroup=membership[id],priorDevelopment=id in dev,priorDevelopmentRoles=dev.get(id,{}).get('roles',[]),
              exposureStatus='DEVELOPMENT_EXPOSED' if id in dev or id in parser_oracles else 'PRIOR_PROSE_EXPOSURE_REVIEW_REQUIRED' if id in exposures else 'METADATA_ONLY_IN_THIS_INVENTORY_NOT_CERTIFIED_UNEXPOSED',
              exposureSources=exposures.get(id,[]),priorDisposition=prior,
              priorDispositionSources=overlay_map.get(id,{}).get('dispositionSources',[]),
              receptorSurvivalEvidence=[r for r in direct_impact if r['pdbId']==id],
              provisionalFamily=p.get('provisionalGroupId'),priorConcern=p.get('concern'),
              status='EXCLUDED' if any(r.startswith('EXCLUDE_') for r in reasons) else 'BLOCKED',
              exclusionOrBlockReasons=reasons,eligibleIndependent=False))
    universe=set(read(V3/'global-text-discovery-2026-09-04/search-union-identifiers.txt').split())|curated
    known=set(read(V3/'global-text-discovery-2026-09-04/known-metadata-identifiers.txt').split())
    captured=set(read(V3/'global-text-discovery-2026-09-04/identifiers.txt').split())|known
    for p in sorted((ROOT/V3).glob('phrase-only-chunk-*/identifiers.txt')):captured.update(read(p.relative_to(ROOT)).split())
    row_map={r['pdbId']:r for r in rows}
    with (OUT/'discovery-and-eligibility-ledger.csv').open('x') as f:
        writer=csv.writer(f);writer.writerow(['pdbId','curatedInventory','metadataCaptureListed','status','relatednessGroup','eligibleIndependent','reason'])
        for id in sorted(universe):
            row=row_map.get(id)
            writer.writerow([id,id in curated,id in captured,row['status'] if row else 'UNREVIEWED_DISCOVERY_ID',row['relatednessGroup'] if row else '',False,';'.join(row['exclusionOrBlockReasons']) if row else 'DISCOVERY_MATCH_IS_NOT_TARGET_ELIGIBILITY;ROLE_EXPOSURE_RELATEDNESS_AND_INPUTS_UNREVIEWED'])
    save(OUT/'curated-target-inventory.json',rows);save(OUT/'relatedness-groups.json',group_rows);save(OUT/'relatedness-links.json',links)
    save(OUT/'prior-exposure-registry.json',dict(development=registry,proseExposureSources={id:paths for id,paths in sorted(exposures.items())},
         legacyDevelopmentAvailability=[dict(reference=id,coordinateAvailability=availability,officialScoringReady=ready,records=n) for (id,availability,ready),n in sorted(legacy_counts.items())],
         newAccessScope='Retained metadata, sequence pregraphs and exposure records only; synthetic and previously exposed 3P0G predictions for implementation testing. No new candidate outcomes inspected.',
         unlistedDoesNotMeanUnexposed=True,trainingExposureAssessment='Separate and unresolved; method-development independence is not predictor-training novelty.'))
    summary=dict(status='INVENTORY_SNAPSHOT_EXECUTION_BLOCKED',discoveryIdentifiers=len(universe),curatedEntries=len(rows),
        metadataCaptureListed=len(universe&captured),unreviewedDiscoveryIdentifiers=len(universe-curated),
        priorDevelopmentEntries=len(dev),assemblyParserControlEntries=len(parser_oracles),priorProseExposureEntries=len(exposures),
        excludedCuratedEntries=sum(r['status']=='EXCLUDED' for r in rows),blockedCuratedEntries=sum(r['status']=='BLOCKED' for r in rows),
        provisionalRelatednessComponents=len(group_rows),certifiedIndependentGroups=0,eligibleTargets=[],
        wholeUniverseIndependentUpperBound=None,discoveryComplete=False,
        metadataSnapshotIsCurrentExhaustiveSearch=False,reviewedThroughRetainedRecords='2026-09-09',
        noNewCandidateOutcomesRead=True,noNewGeneration=True,
        reasons=['All curated entries have an exclusion or unresolved gate.','Pregraphs conservatively group possible relatives and cannot certify absence of relatedness.','Unreviewed discovery IDs are not eligible targets or independent groups.'])
    save(OUT/'summary.json',summary);save(OUT/'source-bindings.json',list(SOURCES.values()))
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
