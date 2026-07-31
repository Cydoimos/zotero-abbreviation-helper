'use strict';
/*
 * Scores the plugin against a hand-built gold standard.
 *
 * Metrics
 *   Recall            : gold abbreviations the plugin found (any meaning)
 *   Meaning accuracy  : of those found, how many meanings are right
 *   Precision         : plugin outputs that are real abbreviations of the paper
 *
 * Meaning grading (strict + partial credit):
 *   correct : matches the author's definition (modulo case/hyphen/plural/stopwords)
 *   partial : right concept but truncated or with extra words attached
 *   wrong   : different concept, or a sentence fragment
 *
 * Usage: node score.js [path-to-abbreviation.js]
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

function load(p) {
  const c = fs.readFileSync(p, 'utf8');
  const sb = { globalThis: {}, Zotero: { debug() {} }, console };
  vm.createContext(sb);
  vm.runInContext(c + '\n;this.__H=AbbreviationHelper;', sb);
  return sb.__H;
}
const dicts = require(path.join(ROOT, 'src/data/abbreviations.json'));
const H = load(process.argv[2] || path.join(ROOT, 'src/abbreviation.js'));
H.dictionaries = { staticDefs: dicts.staticDefs, commonKnownDefs: dicts.commonKnownDefs };

const gold = require('./gold-standard.json');

// The corpus is extracted text from copyrighted papers and is deliberately not
// distributed. Supply your own PDFs to reproduce the accuracy numbers.
{
  const missing = gold.papers.filter(p => !fs.existsSync(path.join(ROOT, p.file)));
  if (missing.length) {
    console.log('No corpus found (' + missing.length + ' of ' + gold.papers.length + ' files missing).\n');
    console.log('eval/gold-standard.json lists the papers and their hand-labelled');
    console.log('abbreviations, but the extracted paper text is copyrighted and is not');
    console.log('redistributed. To reproduce the accuracy figures:');
    console.log('  1. obtain the papers listed in eval/gold-standard.json (all open access)');
    console.log('  2. pdftotext each one into corpus/ using the filename given in "file"');
    console.log('  3. re-run this script');
    process.exit(0);
  }
}

// ---- normalisation for comparing meanings ----------------------------------
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'in', 'on', 'to', 'with', 'by']);
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(common term.*$|\(common possible meanings.*$/, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function contentWords(s) {
  return norm(s).split(/\s+/).filter(w => w && !STOP.has(w)).map(w => w.replace(/s$/, ''));
}
function grade(goldTerm, gotTerm) {
  if (!gotTerm) return 'missing';
  const g = contentWords(goldTerm), p = contentWords(gotTerm);
  if (!g.length || !p.length) return 'wrong';
  if (g.join(' ') === p.join(' ')) return 'correct';
  const gset = new Set(g), pset = new Set(p);
  const overlap = g.filter(w => pset.has(w)).length;
  const extra = p.filter(w => !gset.has(w)).length;
  // All gold words present and no more than one extra word -> correct.
  if (overlap === g.length && extra <= 1) return 'correct';
  // Pure truncation (everything returned is part of the gold term) or a
  // superset (gold fully present plus extra words) -> partial, not wrong.
  if (extra === 0 && overlap >= 1) return 'partial';
  if (overlap === g.length) return 'partial';
  // Half or more of the gold concept present -> partial.
  if (overlap >= Math.ceil(g.length * 0.5) && overlap >= 1) return 'partial';
  return 'wrong';
}

// ---- run --------------------------------------------------------------------
const totals = { gold: 0, found: 0, correct: 0, partial: 0, wrong: 0, out: 0, spurious: 0 };
const errorLog = [];

for (const paper of gold.papers) {
  const text = fs.readFileSync(path.join(ROOT, paper.file), 'utf8');
  const pairs = H._detectAbbreviations(text);
  const got = new Map(pairs.map(p => [p.abbr, p.term]));

  // Match gold abbreviation against plugin output, allowing plural variants and
  // dash variants (PDFs render hyphen/en-dash/figure-dash inconsistently).
  const dash = s => String(s).replace(/[‐-―−-]/g, '-');
  const gotNorm = new Map([...got.entries()].map(([k, v]) => [dash(k), v]));
  function lookup(abbr) {
    const a = dash(abbr);
    if (gotNorm.has(a)) return gotNorm.get(a);
    for (const v of [a + 's', a.replace(/s$/, '')]) if (gotNorm.get(v)) return gotNorm.get(v);
    return null;
  }

  console.log('\n================ ' + paper.name + ' ================');
  let pFound = 0, pCorrect = 0, pPartial = 0, pWrong = 0;
  for (const [abbr, goldTerm] of Object.entries(paper.abbreviations)) {
    totals.gold++;
    const gotTerm = lookup(abbr);
    const g = grade(goldTerm, gotTerm);
    if (g === 'missing') {
      console.log(`  MISS      ${abbr}  (gold: ${goldTerm})`);
      errorLog.push({ paper: paper.name, abbr, type: 'miss', gold: goldTerm });
    } else {
      totals.found++; pFound++;
      if (g === 'correct') { totals.correct++; pCorrect++; }
      else if (g === 'partial') {
        totals.partial++; pPartial++;
        console.log(`  PARTIAL   ${abbr}  gold="${goldTerm}"  got="${gotTerm}"`);
        errorLog.push({ paper: paper.name, abbr, type: 'partial', gold: goldTerm, got: gotTerm });
      } else {
        totals.wrong++; pWrong++;
        console.log(`  WRONG     ${abbr}  gold="${goldTerm}"  got="${gotTerm}"`);
        errorLog.push({ paper: paper.name, abbr, type: 'wrong', gold: goldTerm, got: gotTerm });
      }
    }
  }

  // Precision: outputs not in gold and not an accepted extra are spurious.
  const accepted = new Set([
    ...Object.keys(paper.abbreviations),
    ...(paper.acceptableExtras || []),
    ...(gold.acceptableExtrasGlobal || [])
  ].map(dash));
  const spurious = [...got.keys()].filter(a => {
    const d = dash(a);
    if (accepted.has(d)) return false;
    if (accepted.has(d.replace(/s$/, '')) || accepted.has(d + 's')) return false;
    return true;
  });
  totals.out += got.size;
  totals.spurious += spurious.length;
  for (const s of spurious) {
    console.log(`  SPURIOUS  ${s} => "${String(got.get(s)).slice(0, 70)}"`);
    errorLog.push({ paper: paper.name, abbr: s, type: 'spurious', got: got.get(s) });
  }
  const n = Object.keys(paper.abbreviations).length;
  console.log(`  -- recall ${pFound}/${n} (${(100 * pFound / n).toFixed(0)}%), ` +
    `meanings correct ${pCorrect}, partial ${pPartial}, wrong ${pWrong}, spurious ${spurious.length}`);
}

const rec = 100 * totals.found / totals.gold;
const meaningOk = 100 * totals.correct / Math.max(1, totals.found);
const meaningOkPartial = 100 * (totals.correct + totals.partial) / Math.max(1, totals.found);
const prec = 100 * (totals.out - totals.spurious) / Math.max(1, totals.out);
const endToEnd = 100 * totals.correct / totals.gold;

console.log('\n================ OVERALL ================');
console.log(`gold abbreviations      : ${totals.gold}`);
console.log(`found by plugin         : ${totals.found}  -> RECALL ${rec.toFixed(1)}%`);
console.log(`  meaning correct       : ${totals.correct}  -> ${meaningOk.toFixed(1)}% of found`);
console.log(`  meaning partial       : ${totals.partial}  -> ${meaningOkPartial.toFixed(1)}% correct-or-partial`);
console.log(`  meaning wrong         : ${totals.wrong}`);
console.log(`plugin outputs total    : ${totals.out}`);
console.log(`  spurious              : ${totals.spurious}  -> PRECISION ${prec.toFixed(1)}%`);
console.log(`END-TO-END (found AND correct meaning): ${endToEnd.toFixed(1)}%`);

fs.writeFileSync(path.join(__dirname, 'errors.json'), JSON.stringify(errorLog, null, 2));
console.log('\nerror log -> eval/errors.json  (' + errorLog.length + ' entries)');
