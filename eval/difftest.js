'use strict';
// Compares the FULL detector output of two builds across the whole corpus.
// Used to prove a refactor is behaviour-preserving.
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const dicts=require(path.join(ROOT,'src/data/abbreviations.json'));
const gold=require('./gold-standard.json');
function load(p){const c=fs.readFileSync(p,'utf8');const sb={globalThis:{},Zotero:{debug(){}},console};
 vm.createContext(sb);vm.runInContext(c+'\n;this.__H=AbbreviationHelper;',sb);const H=sb.__H;
 H.dictionaries={staticDefs:dicts.staticDefs,commonKnownDefs:dicts.commonKnownDefs};return H;}
const A=load(process.argv[2]), B=load(process.argv[3]);
let diffs=0, totalA=0, totalB=0;
for(const paper of gold.papers){
  const t=fs.readFileSync(path.join(ROOT,paper.file),'utf8');
  const a=A._detectAbbreviations(t), b=B._detectAbbreviations(t);
  totalA+=a.length; totalB+=b.length;
  const ma=new Map(a.map(p=>[p.abbr,p.term])), mb=new Map(b.map(p=>[p.abbr,p.term]));
  const keys=new Set([...ma.keys(),...mb.keys()]);
  const local=[];
  for(const k of keys){
    if(!mb.has(k)) local.push('  -'+k+' => '+String(ma.get(k)).slice(0,50));
    else if(!ma.has(k)) local.push('  +'+k+' => '+String(mb.get(k)).slice(0,50));
    else if(ma.get(k)!==mb.get(k)) local.push('  ~'+k+'\n      A: '+String(ma.get(k)).slice(0,60)+'\n      B: '+String(mb.get(k)).slice(0,60));
  }
  if(local.length){ diffs+=local.length; console.log('### '+paper.name.split(' - ')[0]); console.log(local.join('\n')); }
}
console.log('\noutputs A='+totalA+'  B='+totalB+'   differences: '+diffs);
console.log(diffs===0 ? 'IDENTICAL — refactor is behaviour-preserving' : 'BEHAVIOUR CHANGED');
