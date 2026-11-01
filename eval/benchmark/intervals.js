'use strict';
/*
 * How certain are the benchmark figures? Papers, not abbreviations, are the
 * unit of sampling (abbreviations within a paper succeed or fail together),
 * so this resamples papers 5000 times and reports 95 % intervals. With a
 * second detector it also gives the interval for the difference, paired by
 * paper. Only aggregates are printed, so it is safe on the test set.
 *
 * Usage
 *   node eval/benchmark/intervals.js dev|test <text-dir> [abbreviation.js abbreviations.json
 *        [other-abbreviation.js other-abbreviations.json]]
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const [set, textDir, ...files] = process.argv.slice(2);
if (set !== 'dev' && set !== 'test' || !textDir) {
  console.log('usage: node eval/benchmark/intervals.js dev|test <text-dir> [plugin.js dict.json [other.js other.json]]');
  process.exit(1);
}

// The scorer's own comparison rules.
const scorer = fs.readFileSync(path.join(__dirname, 'score.js'), 'utf8');
const S = {};
vm.runInNewContext(scorer.slice(scorer.indexOf('// ---- comparing short forms'), scorer.indexOf('// ---- run')) +
  ';S.grade = grade; S.variants = variants; S.key = key; S.UNITS = UNITS;', { S });

function load(pluginFile, dictFile) {
  const sb = { globalThis: {}, Zotero: { debug() {} }, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(pluginFile, 'utf8') + '\n;this.__H = AbbreviationHelper;', sb);
  const dict = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
  sb.__H.dictionaries = { staticDefs: dict.staticDefs, commonKnownDefs: dict.commonKnownDefs };
  return sb.__H;
}

const papers = JSON.parse(fs.readFileSync(path.join(textDir, 'papers.json'), 'utf8')).papers;
// By DOI, or by title for a paper without one (as score.js matches them).
const byDoi = new Map(papers.filter(p => p.doi).map(p => [String(p.doi).toLowerCase(), p]));
const title = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const byTitle = new Map(papers.filter(p => title(p.title)).map(p => [title(p.title), p]));
const labelDir = path.join(__dirname, 'labels', set);
const labelled = fs.readdirSync(labelDir).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(labelDir, f), 'utf8')))
  .map(L => ({ L, paper: (L.doi && byDoi.get(String(L.doi).toLowerCase())) || byTitle.get(title(L.title)) }))
  .filter(x => x.paper);

/** Per-paper counts, scored as score.js scores them. */
function countsPerPaper(H) {
  return labelled.map(({ L, paper }) => {
    const got = new Map();
    for (const x of H._detectAbbreviations(fs.readFileSync(path.join(textDir, paper.file), 'utf8'))) {
      if (!got.has(S.key(x.abbr))) got.set(S.key(x.abbr), x);
    }
    const find = sf => S.variants(sf).map(v => got.get(v)).find(Boolean);
    const c = { defined: 0, found: 0, right: 0, undefined: 0, glossary: 0, outputs: got.size, extra: 0 };
    for (const e of (L.defined || []).filter(e => !e.unclear)) {
      c.defined++;
      const hit = find(e.sf);
      if (hit) { c.found++; if (S.grade(e, hit.term) === 'correct') c.right++; }
    }
    for (const e of (L.undefined || []).filter(e => !e.unclear)) {
      c.undefined++;
      if (find(e.sf)) c.glossary++;
    }
    const known = new Set(S.UNITS);
    for (const sf of [...(L.defined || []), ...(L.undefined || [])].map(e => e.sf).concat(L.ignore || [])) {
      for (const v of S.variants(sf)) known.add(v);
    }
    for (const k of got.keys()) if (!S.variants(k).some(v => known.has(v))) c.extra++;
    return c;
  });
}

const total = (rows, idx, k) => idx.reduce((n, i) => n + rows[i][k], 0);
const METRICS = {
  'defined found': (r, i) => total(r, i, 'found') / total(r, i, 'defined'),
  'meaning correct': (r, i) => total(r, i, 'right') / total(r, i, 'found'),
  'glossary found': (r, i) => total(r, i, 'glossary') / total(r, i, 'undefined'),
  'precision': (r, i) => 1 - total(r, i, 'extra') / total(r, i, 'outputs'),
};

const A = countsPerPaper(load(files[0] || path.join(ROOT, 'src/abbreviation.js'),
  files[1] || path.join(ROOT, 'src/data/abbreviations.json')));
const B = files[2] ? countsPerPaper(load(files[2], files[3])) : null;

let seed = 20261101;                       // fixed, so runs are repeatable
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const n = A.length, all = [...Array(n).keys()], ROUNDS = 5000;
const draws = {};
for (const name of Object.keys(METRICS)) draws[name] = { a: [], d: [] };
for (let r = 0; r < ROUNDS; r++) {
  const idx = all.map(() => Math.floor(random() * n));
  for (const [name, f] of Object.entries(METRICS)) {
    draws[name].a.push(f(A, idx));
    if (B) draws[name].d.push(f(A, idx) - f(B, idx));
  }
}
const interval = xs => {
  const s = xs.filter(Number.isFinite).sort((x, y) => x - y);
  return [s[Math.floor(0.025 * s.length)], s[Math.floor(0.975 * s.length)]];
};
const pct = x => (100 * x).toFixed(1);

console.log(`${set}: ${n} papers, ${total(A, all, 'defined')} defined and ${total(A, all, 'undefined')} undefined labels\n`);
console.log('metric'.padEnd(17) + 'value [95% interval]'.padEnd(24) + (B ? 'other   difference [95% interval]' : ''));
for (const [name, f] of Object.entries(METRICS)) {
  const [lo, hi] = interval(draws[name].a);
  let line = name.padEnd(17) + `${pct(f(A, all))} [${pct(lo)}, ${pct(hi)}]`.padEnd(24);
  if (B) {
    const [dlo, dhi] = interval(draws[name].d);
    line += pct(f(B, all)).padEnd(8) + `${pct(f(A, all) - f(B, all))} [${pct(dlo)}, ${pct(dhi)}]`;
  }
  console.log(line);
}
