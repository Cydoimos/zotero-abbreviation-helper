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
const c=fs.readFileSync(path.join(ROOT,'src/abbreviation.js'),'utf8');
const sb={globalThis:{},Zotero:{debug(){}},console};vm.createContext(sb);
vm.runInContext(c+'\n;this.__H=AbbreviationHelper;',sb);const H=sb.__H;
H.dictionaries={staticDefs:dicts.staticDefs,commonKnownDefs:dicts.commonKnownDefs};

const per=[];
for(const paper of gold.papers){
  const t=fs.readFileSync(path.join(ROOT,paper.file),'utf8');
  const got=new Map(H._detectAbbreviations(t).map(x=>[dash(x.abbr),x.term]));
  const acc=new Set([...Object.keys(paper.abbreviations),...(paper.acceptableExtras||[]),...(gold.acceptableExtrasGlobal||[])].map(dash));
  let G=0,F=0,C=0;
  for(const [a,gt] of Object.entries(paper.abbreviations)){
    G++;const d=dash(a);const v=got.get(d)||got.get(d+'s')||got.get(d.replace(/s$/,''));
    const r=grade(gt,v);if(r!=='missing'){F++;if(r==='correct')C++;}
  }
  const S=[...got.keys()].filter(a=>{const d=dash(a);return !acc.has(d)&&!acc.has(d.replace(/s$/,''))&&!acc.has(d+'s');}).length;
  per.push({name:paper.name.split(' - ')[0],G,F,C,O:got.size,S});
}
console.log('Per-paper results');
console.log('paper                  gold  recall%  meaning%  precision%');
for(const p of per){
  console.log(p.name.padEnd(22)+String(p.G).padStart(5)+(100*p.F/p.G).toFixed(0).padStart(8)+
    (100*p.C/Math.max(1,p.F)).toFixed(0).padStart(10)+(100*(p.O-p.S)/Math.max(1,p.O)).toFixed(0).padStart(12));
}
// Bootstrap over PAPERS (the unit of variation), 5000 resamples.
function pct(a,q){const s=[...a].sort((x,y)=>x-y);return s[Math.floor(q*(s.length-1))];}
const N=per.length,B=5000,rec=[],mea=[],pre=[],e2e=[];
for(let b=0;b<B;b++){
  let G=0,F=0,C=0,O=0,S=0;
  for(let i=0;i<N;i++){const p=per[Math.floor(Math.random()*N)];G+=p.G;F+=p.F;C+=p.C;O+=p.O;S+=p.S;}
  rec.push(100*F/G);mea.push(100*C/Math.max(1,F));pre.push(100*(O-S)/Math.max(1,O));e2e.push(100*C/G);
}
const tot=per.reduce((a,p)=>({G:a.G+p.G,F:a.F+p.F,C:a.C+p.C,O:a.O+p.O,S:a.S+p.S}),{G:0,F:0,C:0,O:0,S:0});
console.log('\nPoint estimate with 95% bootstrap CI (resampling papers, B=5000)');
const row=(n,v,arr)=>console.log('  '+n.padEnd(20)+v.toFixed(1).padStart(6)+'%   [ '+pct(arr,0.025).toFixed(1)+' , '+pct(arr,0.975).toFixed(1)+' ]');
row('Recall',100*tot.F/tot.G,rec);
row('Meaning correct',100*tot.C/tot.F,mea);
row('Precision',100*(tot.O-tot.S)/tot.O,pre);
row('End-to-end',100*tot.C/tot.G,e2e);
