#!/usr/bin/env python3
"""Append-only adjudication of the frozen 270-row backlog; no coordinate scoring."""
import collections,csv,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'validation/benchmark-eligibility-resolution-v1'
def save(name,obj):(OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def main():
 old=ROOT/'validation/prospective-benchmark-v1/inventory/curated-target-inventory.json'
 rows=json.loads(old.read_text()); blocked=[r for r in rows if r['status']=='BLOCKED'];assert len(blocked)==270
 codes=collections.Counter(c for r in blocked for c in r['exclusionOrBlockReasons'])
 classes={
 'BLOCK_DIRECT_RECEPTOR_VHH_ROLE_OR_CONSTRUCT_CERTIFICATION_INCOMPLETE':'unresolved-scientific-certification',
 'BLOCK_COMPLETE_PARENT_FAMILY_AND_NO_EDGE_REVIEW_MISSING':'unresolved-scientific-certification',
 'BLOCK_GENERAL_BENCHMARK_INPUTS_AND_REFERENCE_FEASIBILITY_NOT_LOCKED':'mixed-administrative-artifact-and-scientific-mapping',
 'BLOCK_POSSIBLE_RECEPTOR_OR_NANOBODY_CONNECTION_TO_DEVELOPMENT':'unresolved-scientific-relatedness',
 'BLOCK_RELATED_SOURCE_FAMILY_EXPOSURE_REVIEW':'unresolved-exposure-adjudication',
 'BLOCK_PRIOR_STRUCTURAL_OR_PREDICTION_PROSE_EXPOSURE_REVIEW':'recorded-prose-exposure-needs-disposition',
 'BLOCK_ENGINEERED_ADRB2_GRAFT_RELATED_TO_DEVELOPMENT':'scientific-development-related-graft'}
 assert set(codes)==set(classes)
 updated=[];partitions=collections.Counter()
 for r in blocked:
  reasons=r['exclusionOrBlockReasons']
  partition=('possible-development-connection' if any('POSSIBLE_RECEPTOR' in x for x in reasons) else 'exposure-review-without-possible-sequence-connection' if any('EXPOSURE_REVIEW' in x for x in reasons) else 'three-generic-certification-blockers')
  partitions[partition]+=1
  final='EXCLUDED' if r['pdbId'] in ('7UL3','9W3K') else 'BLOCKED'
  decision=('Known Nb6 parent/scaffold graft and KOR receptor epitope graft; source-backed scientific exclusion.' if r['pdbId']=='7UL3' else 'Positive frozen Nb6 sequence connection to development 6VI4; current native inspection verifies receptor A / NB6 B interface and exact metadata sequence. Scientific relatedness exclusion; no assertion of endogenous GPR151 epitope binding.' if r['pdbId']=='9W3K' else 'Unchanged; incomplete certification is not proof of scientific ineligibility.')
  updated.append(dict(pdbId=r['pdbId'],originalStatus=r['status'],updatedStatus=final,primaryBacklogPartition=partition,originalReasons=reasons,administrativeMissingness=['exact input/MSA file seal','execution bundle and resource seal'],scientificCertificationMissing=['direct role and construct','complete ancestry/no-edge and exposure adjudication','reference assembly/mapping quality'],decision=decision,eligibleIndependent=False))
 save('blocked-entry-resolution.json',updated)
 with (OUT/'blocked-entry-resolution.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=['pdbId','originalStatus','updatedStatus','primaryBacklogPartition','originalReasons','administrativeMissingness','scientificCertificationMissing','decision','eligibleIndependent']);w.writeheader()
  for r in updated:w.writerow({k:'; '.join(v) if isinstance(v,list) else v for k,v in r.items()})
 save('blocker-summary.json',dict(sourceSha256=hashlib.sha256(old.read_bytes()).hexdigest(),originalBlocked=270,overlappingReasons=[dict(reason=k,count=v,classification=classes[k]) for k,v in sorted(codes.items())],mutuallyExclusivePartitions=dict(partitions),administrativeOnlyCertifiedTargets=0,newScientificExclusions=['7UL3','9W3K'],remainingBlocked=268,totalExcludedIncludingOriginal=80,clearedProspectiveTargets=[],certifiedIndependentGroups=[],scope='Finite curated snapshot only. The 242 possible links are not 242 proved exclusions. No claim that all remaining targets are scientifically ineligible or that the global population is empty.'))
 save('cleared-targets.json',dict(independentTargets=[],independentGroups=[],retrospectiveReferenceComplexes=['3P0G','4MQS','5C1M','5JQH'],retrospectiveUse='Existing exposed coordinate compatibility and structural-audit evaluation; no independent-validation inference; legacy confidence may abstain.',prospectiveGenerationAllowed=False))
 print(json.dumps(dict(overlap=dict(codes),partitions=dict(partitions),cleared=0,newExclusions=2)))
if __name__=='__main__':main()
