// Post-outcome reference diagnostic only. Never add experimental coordinates to the candidate pool.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [repoArg,nativeArg,outArg]=process.argv.slice(2);
if (!repoArg||!nativeArg||!outArg)throw Error('Usage: node native-diagnostic.mjs FROZEN_REPO NATIVE_AB_PDB NEW_OUTPUT_JSON');
const repo=path.resolve(repoArg),native=path.resolve(nativeArg),out=path.resolve(outArg);
const {analyzeInterface}=await import(pathToFileURL(path.join(repo,'lib/confovhh.ts')));
const {parseCoordinateText}=await import(pathToFileURL(path.join(repo,'lib/coordinate-parser.ts')));
const {canonicalizeSelectedGeometry}=await import(pathToFileURL(path.join(repo,'lib/geometry-fit.ts')));
const {scorePoseRanking}=await import(pathToFileURL(path.join(repo,'lib/pose-ranking.ts')));
const bytes=await readFile(native);const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!=='f9c2b4e63bcf9beda92cfd147686186e24e1f098472e15447fa1f76cbbdbb557')throw Error('Unexpected frozen reference preflight bytes');
const structure=parseCoordinateText(bytes.toString('utf8'),'native_AB.pdb',{modelId:'1'});
const canonical=canonicalizeSelectedGeometry(structure,'A','B');
const audit=analyzeInterface(structure,'A','B','none',null,false,canonical);
await writeFile(out,JSON.stringify({schema:'confovhh-post-outcome-native-diagnostic-v1',claimBoundary:'Experimental observed reference geometry diagnostic, excluded from the ten-candidate ranking pool; not an independent validation case.',referenceSha256:hash,scoringSettings:{confidenceMode:'none',pae:null,receptorChain:'A',vhhChain:'B',sasaFrame:'canonical-selected-geometry'},chains:structure.chains.map(({id,residueCount,atomCount,backboneCompleteness,sequence})=>({id,residueCount,atomCount,backboneCompleteness,sequence})),audit,ranking:scorePoseRanking(audit)},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({evidenceLevel:audit.evidenceLevel,area:audit.halfDeltaSasaInterfaceAreaAngstrom2,severeClashCount:audit.severeClashCount,contacts:audit.contactPairCount,maximumOverlapAngstrom:audit.maximumOverlapAngstrom}));
