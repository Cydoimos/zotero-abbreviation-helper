'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.join(__dirname,'..');
const dicts=require(path.join(ROOT,'src/data/abbreviations.json'));
const gold=require('./gold-standard.json');
const STOP=new Set(['the','a','an','of','and','or','for','in','on','to','with','by']);
const dash=s=>String(s).replace(/[‐-―−-]/g,'-');
function norm(s){return String(s||'').toLowerCase().replace(/\(common term.*$|\(common possible meanings.*$/,'').replace(/[‐-―]/g,'-').replace(/[^a-z0-9]+/g,' ').trim();}
function cw(s){return norm(s).split(/\s+/).filter(w=>w&&!STOP.has(w)).map(w=>w.replace(/s$/,''));}
function grade(gt,pt){if(!pt)return'missing';const g=cw(gt),p=cw(pt);if(!g.length||!p.length)return'wrong';
 if(g.join(' ')===p.join(' '))return'correct';const gs=new Set(g),ps=new Set(p);
 const ov=g.filter(w=>ps.has(w)).length,ex=p.filter(w=>!gs.has(w)).length;
 if(ov===g.length&&ex<=1)return'correct';if(ex===0&&ov>=1)return'partial';if(ov===g.length)return'partial';
 if(ov>=Math.ceil(g.length*0.5)&&ov>=1)return'partial';return'wrong';}
function run(file,floor){
 const c=fs.readFileSync(file,'utf8');const sb={globalThis:{},Zotero:{debug(){}},console};
 vm.createContext(sb);vm.runInContext(c+'\n;this.__H=AbbreviationHelper;',sb);const H=sb.__H;
 H.dictionaries={staticDefs:dicts.staticDefs,commonKnownDefs:dicts.commonKnownDefs};
 H._alignmentFloor=floor;
 let G=0,F=0,C=0,P=0,W=0,O=0,S=0;
 for(const paper of gold.papers){
  const t=fs.readFileSync(path.join(ROOT,paper.file),'utf8');
  const got=new Map(H._detectAbbreviations(t).map(x=>[dash(x.abbr),x.term]));
  const acc=new Set([...Object.keys(paper.abbreviations),...(paper.acceptableExtras||[]),...(gold.acceptableExtrasGlobal||[])].map(dash));
  for(const [a,gt] of Object.entries(paper.abbreviations)){
   G++;const d=dash(a);let v=got.get(d)||got.get(d+'s')||got.get(d.replace(/s$/,''));
   const r=grade(gt,v);if(r==='missing')continue;F++;if(r==='correct')C++;else if(r==='partial')P++;else W++;}
  O+=got.size;
  S+=[...got.keys()].filter(a=>{const d=dash(a);return !acc.has(d)&&!acc.has(d.replace(/s$/,''))&&!acc.has(d+'s');}).length;
 }
 return {floor,recall:100*F/G,meaning:100*C/F,prec:100*(O-S)/O,e2e:100*C/G,spurious:S,found:F};
}
const file=process.argv[2];
console.log('floor  recall  meaning  precision  end-to-end  spurious');
for(const f of [0,0.4,0.6,0.75,0.9,1.0,1.1,1.25,1.5]){
 const r=run(file,f);
 console.log(String(f).padEnd(6)+r.recall.toFixed(1).padStart(6)+r.meaning.toFixed(1).padStart(9)+r.prec.toFixed(1).padStart(11)+r.e2e.toFixed(1).padStart(12)+String(r.spurious).padStart(10));
}
