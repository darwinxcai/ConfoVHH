// Synthetic prediction fixture only. Never reads real coordinates or outcomes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assessValidity, decomposeCdr } from '../../ConfoVHH/scripts/external-ranking-v3/policy.mjs';
const sha = s => createHash('sha256').update(s).digest('hex');
const groups = {dev_6knm:'APLNR-JN241',dev_8qot:'OPRM1-NbE',dev_8th3:'AGTR1-AT118',dev_8th4:'AGTR1-AT118'};
const binding = name => ({path:name,bytes:1,sha256:sha(name)});
const params = JSON.parse(readFileSync(0,'utf8'));
const sourceManifest = {schema:'confovhh-external-development-input-v1',studyId:'synthetic-dev',generators:[{id:'boltz-pair',scoreName:'confidence_score',direction:'higher-better'}],sets:[],attempts:[]};
const input = {schema:'confovhh-source-first-input-v3',studyId:'synthetic-dev',evaluationRole:'development',sourceScoreReceipt:binding('scores/receipt.json'),
  producerProfiles:[{generatorId:'boltz-pair',version:'boltz-2.2.1',scoreContext:'pair-confidence',scoreProvenance:binding('producer.json'),calibration:null}],setPolicies:[]};
const features=[];
const structure={chains:['R','V'].map(id=>({id,atomCount:2,sequence:'AA',residues:[1,2].map(number=>({number,insertionCode:'',atoms:[{name:'CA',x:3.8*number,y:id==='R'?0:4,z:0}]}))})),selectedModelId:'1',malformedAtomRecords:0,duplicateAtomRecords:0,residueNameConflicts:0,zeroOccupancyAtomRecords:0,ignoredHydrogens:0,ignoredAlternateLocations:0,unsupportedResidueRecords:0};
for (const [setId,group] of Object.entries(groups)) {
  const set={id:setId,receptorChain:'R',vhhChain:'V',selectedModelId:'1'},policy={setId,biologicalGroupId:group,receptorSequenceSha256:null,vhhSequenceSha256:null};
  sourceManifest.sets.push(set);input.setPolicies.push(policy);
  for(let seed=0;seed<25;seed++) {
    const id=setId+'_seed'+String(seed).padStart(2,'0'), attempt={id,setId,generatorId:'boltz-pair',status:'generated',reason:'',coordinate:{...binding(id+'.pdb'),format:'pdb'},producerScore:{...binding(id+'.json'),jsonPointer:'/confidence_score'}};
    sourceManifest.attempts.push(attempt);
    const score=seed===0?1:seed===1?1-(params.gaps?.[setId]??.003):.5-seed*.01;
    const count=seed===0?1:seed===1?9:5;
    const audit={contactPairCount:10,paratopeProxyShare:count/10,vhhNumbering:{status:'numbered'},contacts:Array.from({length:10},(_,i)=>({receptorResidue:'R:'+i,vhhResidue:'V:'+i,vhhRegion:i<count?'CDR3-IMGT':'FR3-IMGT'}))};
    features.push({id,setId,generatorId:'boltz-pair',producerStatus:'generated',coordinateSha256:attempt.coordinate.sha256,sourceAuditSha256:sha(id+'audit'),contactEvidence:{kind:'full-audit',sha256:sha(id+'audit')},source:{status:'present',rawValue:score,preferredValue:score,reason:'',binding:attempt.producerScore},validity:assessValidity(structure,set,policy),interface:{status:'contacting',contactPairCount:10},cdr:decomposeCdr(audit)});
  }
}
process.stdout.write(JSON.stringify({bundles:[{input,sourceManifest,features,calibrations:{}}],frozenAtUtc:'2026-09-25T00:00:00Z'})+'\n');
