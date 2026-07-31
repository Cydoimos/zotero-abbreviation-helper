'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
function load(path) {
  const code = fs.readFileSync(path, 'utf8');
  const sb = { globalThis: {}, Zotero: { debug() {} }, console };
  vm.createContext(sb); vm.runInContext(code + '\n;this.__H=AbbreviationHelper;', sb);
  return sb.__H;
}
const dicts = require('../src/data/abbreviations.json');
const H = load(SRC_DIR + '/abbreviation.js');
H.dictionaries = { staticDefs: dicts.staticDefs, commonKnownDefs: dicts.commonKnownDefs };

let pass = true;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? '  ' + detail : ''));
  if (!cond) pass = false;
}
function get(pairs, abbr) { const p = pairs.find(x => x.abbr === abbr); return p ? p.term : null; }

// Case A: no paragraph break at all — layer 1 (block boundary) cannot fire,
// so the per-entry word window must bound the damage on its own.
const noBreak = 'Abbreviations: BAs, bile acids; RS, resistant starch phenolic compounds, all of which are considered to be bioactive compounds and are widely distributed across many different legume species studied to date. The following section describes the methods used.';
const a = H._detectAbbreviations(noBreak);
const rsA = get(a, 'RS');
check('A: BAs still detected', get(a, 'BAs') === 'bile acids');
check('A: RS is bounded (not a paragraph)', rsA && rsA.length <= 60, '-> ' + JSON.stringify(rsA));

// Case B: real-world shape (paragraph break present) -> exact definition.
const withBreak = 'Abbreviations: BAs, bile acids; CHD, coronary heart disease; RS, resistant starch\n\nphenolic compounds, all of which are considered to be bioactive compounds [2]. Epidemiological studies indicate that legume consumption is associated with lower risk.';
const b = H._detectAbbreviations(withBreak);
check('B: RS is exactly "resistant starch"', get(b, 'RS') === 'resistant starch', '-> ' + JSON.stringify(get(b, 'RS')));
check('B: CHD intact', get(b, 'CHD') === 'coronary heart disease');

// Case C: legitimate long definitions must survive untouched.
const legit = 'Abbreviations: SDS-PAGE, sodium dodecyl sulfate polyacrylamide gel electrophoresis; PAST, Paleontological Statistics Software Package; GC-FID, GC-flame ionization detector; AUC, areas under the curve.';
const c = H._detectAbbreviations(legit);
check('C: SDS-PAGE full 6-word definition kept',
  get(c, 'SDS-PAGE') === 'sodium dodecyl sulfate polyacrylamide gel electrophoresis', '-> ' + JSON.stringify(get(c, 'SDS-PAGE')));
check('C: PAST kept', get(c, 'PAST') === 'Paleontological Statistics Software Package', '-> ' + JSON.stringify(get(c, 'PAST')));
check('C: GC-FID kept', get(c, 'GC-FID') === 'GC-flame ionization detector', '-> ' + JSON.stringify(get(c, 'GC-FID')));
check('C: AUC kept', get(c, 'AUC') === 'areas under the curve', '-> ' + JSON.stringify(get(c, 'AUC')));

// Case D: numeric formula/spectra fragments must never become a definition.
// (Pattern A can still pair a bracketed token with a weak single-word
// neighbour such as "ion"; that is pre-existing behaviour and attempts to
// tighten it produced strictly worse expansions, so it is left alone.)
const junk = 'The ion [M-H]- m/z 407 was observed. The ion [M-H]- m/z 407 was observed again in the second run.';
const d = H._detectAbbreviations(junk);
const mh = get(d, 'M-H');
check('D: no numeric-fragment definition like "z 407"',
  mh === null || /[A-Za-z]{3}/.test(mh), '-> ' + JSON.stringify(mh));
check('D: every term contains a real word',
  d.every(p => /[A-Za-z]{3}/.test(p.term)));

// Case E: nothing in any output may exceed the hard cap.
const all = [].concat(a, b, c, d);
const over = all.filter(p => p.term.length > 160);
check('E: no term exceeds 160 chars', over.length === 0, over.map(p => p.abbr).join(','));

console.log('\n' + (pass ? 'ALL RUNAWAY TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(pass ? 0 : 1);
