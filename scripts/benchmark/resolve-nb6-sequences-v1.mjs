import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const engineRoot=process.argv[4];
const engineBytes=await readFile(engineRoot+'/scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs');
if(createHash('sha256').update(engineBytes).digest('hex')!=='5e46e17d7f14315bd9f87da60dffb7db7ce7a328c6db96e1e8f9fe8c9662ffeb') throw Error('Sequence engine changed');
for(const [name,digest] of Object.entries({'package.json':'733c9d00636ec6b88ba3ff7584ecc2fb77380eb5d65750cdcacdd9214299b098','immunum.js':'a53007322b0a006421fd65d816a6e4f4c4cd2f5b4092e824bb9367bad1f92f00','immunum_bg.wasm':'68804983b37b3746f65d84c9c6c0e703361ea9191fe3edc3d0748cddad2c646b'})){if(createHash('sha256').update(await readFile(engineRoot+'/node_modules/immunum/'+name)).digest('hex')!==digest)throw Error('Numbering dependency changed: '+name);}
const {numberVhhForLeakage,alignGlobalAffine,evaluateFrozenVhhThreshold}=await import(pathToFileURL(engineRoot+'/scripts/hard-decoy/v3-vhh-sequence-pregraph.mjs'));
const root=process.argv[2], out=process.argv[3];
const paths=['validation/hard-decoy-holdout-v3/entry-metadata-snapshot-2026-08-29/entries.jsonl','validation/hard-decoy-holdout-v3/domain-remainder-metadata-2026-09-03/entries.jsonl'];
const source=await readFile(root+'/validation/hard-decoy-holdout-v3/gpr151-source-review-2026-09-04/sequence-evidence/nb6-local-comparison.json','utf8');
const preserved=JSON.parse(source);
paths[1]=preserved.inputs[0].path;
const rows=[];const inputs=[];
for(const p of paths){const b=await readFile(root+'/'+p);inputs.push({path:p,sha256:createHash('sha256').update(b).digest('hex')});rows.push(...b.toString().trim().split('\n').map(JSON.parse));}
const dp='validation/hard-decoy-holdout-v3/vhh-sequence-pregraph-2026-08-29/development-vhh-profiles.jsonl';const db=await readFile(root+'/'+dp);inputs.push({path:dp,sha256:createHash('sha256').update(db).digest('hex')});const dev=db.toString().trim().split('\n').map(JSON.parse);
const results=[];
for(const id of ['7UL3','9W3K']){
 const r=rows.find(r=>r.pdbId===id);if(!r)throw Error(id);
 const e=r.polymerEntities.find(e=>/nanobody.?6|\bNB6\b/i.test(e.description));if(!e)throw Error(JSON.stringify(r.polymerEntities));
 const seq=e.sequence;const p=numberVhhForLeakage(seq);if(p.numberingStatus!=='NUMBERED') throw Error('Numbering failed');
 const comparisons=dev.filter(d=>d.frameworkSequence&&d.cdr3Sequence).map(d=>{const framework=alignGlobalAffine(p.frameworkSequence,d.frameworkSequence),cdr3=alignGlobalAffine(p.cdr3Sequence,d.cdr3Sequence);return {developmentId:d.nodeId??d.pdbId,developmentEntityId:d.entityId,framework,cdr3,...evaluateFrozenVhhThreshold({framework,cdr3,cdr3LengthA:p.cdr3Length,cdr3LengthB:d.cdr3Length})};});
 results.push({pdbId:id,metadataTitle:r.title,entity:e,numbering:p,comparisons});
}
await writeFile(out,JSON.stringify({schema:'confovhh.eligibility-sequence-resolution.v1',inputs,results},null,2)+'\n');
console.log(results.map(r=>({id:r.pdbId,numbering:r.numbering.numberingStatus,hits:r.comparisons.filter(x=>x.thresholdCriterionSatisfied).map(x=>({id:x.developmentId,framework:x.framework.identity,cdr3:x.cdr3.identity}))})));
