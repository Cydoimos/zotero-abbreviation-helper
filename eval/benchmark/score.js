'use strict';
/*
 * Scores the detector against the benchmark labels in labels/<set>/.
 *
 * The labels are complete: every short form in a paper is either labelled
 * (defined / undefined) or listed in "ignore". So unlike eval/score.js, this
 * can measure precision as well as recall.
 *
 * Metrics
 *   Recall     : labelled short forms the detector listed (any meaning)
 *   Meaning    : of those, how many meanings are right (correct / partial)
 *   Precision  : outputs that are neither labelled nor in "ignore"
 *   Glossary   : the same, for short forms the paper never defines
 *
 * Usage
 *   node eval/benchmark/score.js dev  <text-dir> [abbreviation.js [abbreviations.json]]
 *   node eval/benchmark/score.js test <text-dir> [abbreviation.js [abbreviations.json]]
 *
 * <text-dir> is a folder written by export-from-zotero.js: papers.json plus
 * one <ZoteroKey>.txt per paper. The paper text comes from Zotero's own PDF
 * reader, so the detector sees exactly what it sees in the app.
 *
 * The extracted text is copyrighted and is not distributed with the plugin;
 * the labels and the paper lists are.
 *
 * On the test set only aggregates are printed. Individual test errors must not
 * steer the detector - that is what the dev set is for. Pass --errors to write
 * the dev error list to a file.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const set = process.argv[2];
const textDir = process.argv[3];
const args = process.argv.slice(4).filter(a => !a.startsWith('--'));
const wantErrors = process.argv.includes('--errors');
if (set !== 'dev' && set !== 'test' || !textDir) {
  console.log('usage: node eval/benchmark/score.js dev|test <text-dir> [abbreviation.js [abbreviations.json]] [--errors]');
  process.exit(1);
}

// ---- the detector ----------------------------------------------------------
function load(p) {
  const c = fs.readFileSync(p, 'utf8');
  const sb = { globalThis: {}, Zotero: { debug() {} }, console };
  vm.createContext(sb);
  vm.runInContext(c + '\n;this.__H=AbbreviationHelper;', sb);
  return sb.__H;
}
// The dictionary can be given too, to score an older version as it shipped.
const dicts = JSON.parse(fs.readFileSync(args[1] || path.join(ROOT, 'src/data/abbreviations.json'), 'utf8'));
const H = load(args[0] || path.join(ROOT, 'src/abbreviation.js'));
H.dictionaries = { staticDefs: dicts.staticDefs, commonKnownDefs: dicts.commonKnownDefs };

// ---- labels and texts ------------------------------------------------------
const labelDir = path.join(__dirname, 'labels', set);
if (!fs.existsSync(labelDir)) { console.log('no labels in ' + labelDir); process.exit(1); }
const labels = fs.readdirSync(labelDir).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(labelDir, f), 'utf8')));

const papersFile = path.join(textDir, 'papers.json');
if (!fs.existsSync(papersFile)) {
  console.log('no papers.json in ' + textDir + '\n');
  console.log('Run eval/benchmark/export-from-zotero.js inside Zotero first; it writes');
  console.log('papers.json and one text file per paper. See eval/benchmark/README.md.');
  process.exit(0);
}
const exported = JSON.parse(fs.readFileSync(papersFile, 'utf8')).papers || [];
const id = p => String(p.doi || (p.archiveID ? 'arXiv:' + String(p.archiveID).split(':').pop() : '') || '')
  .toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
const byId = new Map(exported.map(p => [id(p), p]));
// A preprint may carry no DOI and no arXiv ID in the library, so a label can
// also name the Zotero item key its text was exported under.
const byKey = new Map(exported.map(p => [String(p.file || '').replace(/\.txt$/, ''), p]));

// ---- comparing short forms -------------------------------------------------
// PDFs render hyphen, en-dash and figure-dash inconsistently, and a paper may
// define the singular and use the plural.
const dash = s => String(s).replace(/[‐-―−﹘﹣－]/g, '-');
const key = s => dash(s).toLowerCase();
const variants = s => {
  const k = key(s), v = new Set([k]);
  v.add(k + 's'); v.add(k.replace(/s$/, ''));
  v.add(k.replace(/ies$/, 'y')); v.add(k.replace(/y$/, 'ies'));
  return [...v].filter(Boolean);
};

// Units are always ignored (GUIDELINES.md), so outputs for them are never
// false positives; where a paper's labels list one, it is scored as labelled.
const UNITS = ['bp', 'nt', 'kb', 'aa', 'kda', 'da', 'mda', 'nm', 'mm', 'mg', 'ml'];

// ---- comparing meanings ----------------------------------------------------
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'in', 'on', 'to', 'with', 'by']);
// A Greek letter and its name are the same word ("β-D-maltoside", "beta-D-
// maltoside"), and accents do not change a meaning ("Biomédica").
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta',
  θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho',
  σ: 'sigma', τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega' };
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[α-ω]/g, c => ' ' + (GREEK[c] || '') + ' ')
    .normalize('NFD').replace(/\p{M}/gu, '')
    // the plugin's notes on where a meaning comes from are not part of it
    .replace(/\((?:common term|common possible meanings|probable|possible meanings from|from (?:another paper|\d+ other papers))[^()]*\)\s*$/, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function contentWords(s) {
  return norm(s).split(/\s+/).filter(w => w && !STOP.has(w)).map(w => w.replace(/s$/, ''));
}
// PDF text extraction loses hyphens and splits or glues words ("bone
// marrowderived", "deep neural net works", "Im proving"). The label records the
// true meaning, so compare word spacing-blind as well: the detector can only
// return what the extracted text says, and that is not its mistake.
function squash(s) {
  return norm(s).replace(/\s+/g, '').replace(/s$/, '');
}
function gradeOne(want, got) {
  const sw = squash(want), sg = squash(got);
  if (sw && sg && sw === sg) return 'correct';
  const g = contentWords(want), p = contentWords(got);
  if (!g.length || !p.length) return 'wrong';
  if (g.join(' ') === p.join(' ')) return 'correct';
  const gset = new Set(g), pset = new Set(p);
  const overlap = g.filter(w => pset.has(w)).length;
  const extra = p.filter(w => !gset.has(w)).length;
  if (overlap === g.length && extra <= 1) return 'correct';
  if (extra === 0 && overlap >= 1) return 'partial';
  if (overlap === g.length) return 'partial';
  if (overlap >= Math.ceil(g.length * 0.5) && overlap >= 1) return 'partial';
  if (sw && sg && (sg.includes(sw) || sw.includes(sg))) return 'partial';
  return 'wrong';
}
// The best grade over the label's long form and any accepted alternatives.
const RANK = { correct: 3, partial: 2, wrong: 1 };
function grade(entry, got) {
  if (!got) return 'missing';
  let best = 'wrong';
  for (const want of [entry.lf, ...(entry.alt || [])]) {
    const g = gradeOne(want, got);
    if (RANK[g] > RANK[best]) best = g;
  }
  return best;
}

// ---- run -------------------------------------------------------------------
const blank = () => ({ n: 0, found: 0, correct: 0, partial: 0, wrong: 0 });
const T = { def: blank(), undef: blank(), blind: blank(), out: 0, fp: 0, unclear: 0, papers: 0, perPaper: [] };
const errors = [];
const missingText = [];

for (const L of labels) {
  const p = byId.get(id(L)) || (L.key ? byKey.get(L.key) : undefined);
  if (!p) { missingText.push(L.doi || L.key); continue; }
  const file = path.join(textDir, p.file);
  if (!fs.existsSync(file)) { missingText.push(L.doi || L.key); continue; }
  const text = fs.readFileSync(file, 'utf8');

  const pairs = H._detectAbbreviations(text);
  const got = new Map();
  for (const x of pairs) if (!got.has(key(x.abbr))) got.set(key(x.abbr), { abbr: x.abbr, term: x.term });
  const lookup = sf => { for (const v of variants(sf)) if (got.has(v)) return got.get(v); return null; };

  const P = { name: (L.journal || L.doi), def: blank(), undef: blank(), blind: blank(), out: got.size, fp: 0 };

  for (const [kind, list] of [['def', L.defined || []], ['undef', L.undefined || []]]) {
    for (const e of list) {
      if (e.unclear) { T.unclear++; continue; }
      // Entries added during reconciliation (see reconciliation-<set>.md) were
      // found because the detector listed them, so they would flatter the
      // glossary score. They are also counted separately, without them.
      const sets = [P[kind]];
      if (kind === 'undef' && !e.recon) sets.push(P.blind);
      for (const S of sets) S.n++;
      const hit = lookup(e.sf);
      const g = grade(e, hit && hit.term);
      if (g === 'missing') {
        if (set === 'dev') errors.push({ paper: P.name, kind, sf: e.sf, type: 'miss', want: e.lf });
        continue;
      }
      for (const S of sets) { S.found++; S[g]++; }
      if (g !== 'correct' && set === 'dev') {
        errors.push({ paper: P.name, kind, sf: e.sf, type: g, want: e.lf, got: hit.term });
      }
    }
  }

  // Precision: an output is a false positive when it is neither labelled nor
  // listed in "ignore". Unclear entries are accepted either way, and so are
  // units, which the guidelines always ignore unless a paper's labels list them.
  const accepted = new Set(UNITS);
  for (const s of [...(L.defined || []).map(e => e.sf), ...(L.undefined || []).map(e => e.sf), ...(L.ignore || [])]) {
    for (const v of variants(s)) accepted.add(v);
  }
  for (const [k, v] of got) {
    if (variants(k).some(x => accepted.has(x))) continue;
    P.fp++;
    if (set === 'dev') errors.push({ paper: P.name, sf: v.abbr, type: 'false positive', got: v.term });
  }

  T.papers++;
  for (const k of ['def', 'undef', 'blind']) for (const f of Object.keys(blank())) T[k][f] += P[k][f];
  T.out += P.out; T.fp += P.fp;
  T.perPaper.push(P);
}

// ---- report ----------------------------------------------------------------
if (!T.papers) {
  console.log('No paper text found for the ' + set + ' labels in ' + textDir + '.');
  console.log('Export the texts from Zotero first (see eval/benchmark/README.md).');
  process.exit(0);
}
const pc = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
function block(title, S) {
  console.log('  ' + title.padEnd(22) + String(S.n).padStart(5) + ' labelled   ' +
    'recall ' + pc(S.found, S.n).padStart(6) + '   ' +
    'meaning ' + pc(S.correct, S.found).padStart(6) +
    '   (+partial ' + pc(S.partial, S.found).trim() + ', wrong ' + pc(S.wrong, S.found).trim() + ')');
}
console.log('\n' + set + ' set: ' + T.papers + ' papers' +
  (missingText.length ? ' (' + missingText.length + ' without text, skipped)' : ''));
console.log('');
block('defined in the paper', T.def);
block('never defined', T.undef);
if (T.undef.n !== T.blind.n) block('  of those, blind', T.blind);
console.log('  ' + 'precision'.padEnd(22) + String(T.out).padStart(5) + ' outputs    ' +
  'correct ' + pc(T.out - T.fp, T.out).padStart(6) + '   (' + T.fp + ' not in the labels)');
if (T.unclear) console.log('  ' + T.unclear + ' entries left out (meaning unclear in the paper)');

if (set === 'dev') {
  console.log('\nPer paper');
  for (const P of T.perPaper) {
    const n = P.def.n + P.undef.n, f = P.def.found + P.undef.found, c = P.def.correct + P.undef.correct;
    console.log('  ' + String(P.name).slice(0, 34).padEnd(36) + String(n).padStart(4) +
      pc(f, n).padStart(9) + pc(c, f).padStart(9) + ('fp ' + P.fp).padStart(8));
  }
  if (wantErrors) {
    const out = path.join(__dirname, 'errors-dev.json');
    fs.writeFileSync(out, JSON.stringify(errors, null, 1) + '\n');
    console.log('\n' + errors.length + ' errors written to ' + path.relative(ROOT, out));
  } else if (errors.length) {
    console.log('\n' + errors.length + ' errors; re-run with --errors to write them to a file.');
  }
} else {
  console.log('\nTest-set errors are deliberately not printed. Tune on the dev set.');
}
console.log('');
