'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Peptide sequences printed in parentheses must not be mistaken for
 * abbreviations, while genuine abbreviations of the same shape survive.
 * The passage below is synthetic: it reproduces the pattern that caused the
 * original false positives without reproducing any copyrighted text. */
const fs = require('fs'), vm = require('vm');

function load(p) {
  const c = fs.readFileSync(p, 'utf8');
  const sb = { globalThis: {}, Zotero: { debug() {} }, console };
  vm.createContext(sb); vm.runInContext(c + '\n;this.__H=AbbreviationHelper;', sb);
  return sb.__H;
}
const dicts = require('../src/data/abbreviations.json');
const H = load(SRC_DIR + '/abbreviation.js');
H.dictionaries = dicts;

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const abbrs = t => new Set(H._detectAbbreviations(t).map(p => p.abbr));
const termOf = (t, a) => { const p = H._detectAbbreviations(t).find(x => x.abbr === a); return p ? p.term : null; };

const paper = [
  'Peptide sequences were identified in the hydrolysate by mass spectrometry.',
  'The isoelectric point ranged from the acidic pI 2.78 (DLVLDVPS) to alkaline pI 11.52 (KPSSAAGAVR).',
  'Hydrophobicity ranged from 4.88 (TKAGGTAF) to 22.78 (VELVGPK) kcal/mol.',
  'Free energy values ranged from -5.5 (CSSSSG) to -7.6 (FEDGLV), and binding affinities',
  'from -6.1 (PYGVPVGVR) to -8.8 (VNPDPAGGPTSGRAL) for the residues studied.',
  'Legume protein hydrolysates (LPH) were prepared. LPH samples were compared.',
  'Angiotensin-converting enzyme (ACE) activity was measured; ACE inhibition rose.',
  'Dipeptidyl peptidase-IV (DPP-IV) was assayed. DPP-IV values are reported.'
].join(' ');

const got = abbrs(paper);
for (const p of ['DLVLDVPS','KPSSAAGAVR','TKAGGTAF','VELVGPK','CSSSSG','FEDGLV','PYGVPVGVR','VNPDPAGGPTSGRAL'])
  check('peptide "' + p + '" not detected', !got.has(p));
for (const a of ['LPH','ACE','DPP-IV'])
  check('kept genuine abbreviation ' + a, got.has(a));

// A real acronym of the same letter-shape survives, because it aligns.
const prisma = 'Peptide residues in the hydrolysate. We followed the Preferred Reporting Items for '
  + 'Systematic Reviews and Meta-Analyses (PRISMA) guideline. PRISMA again.';
check('aligned acronym PRISMA survives', termOf(prisma, 'PRISMA') !== null, '-> ' + termOf(prisma, 'PRISMA'));

// Dictionary entries of that shape stay exempt.
const crispr = 'Peptide residues analysed. Clustered regularly interspaced short palindromic '
  + 'repeats (CRISPR) editing. CRISPR again.';
check('dictionary entry CRISPR survives', termOf(crispr, 'CRISPR') !== null);

// The rule is inert when the document does not discuss peptides.
const noPeptide = 'The Preferred Reporting Items for Systematic Reviews and Meta-Analyses (PRISMA) '
  + 'guideline. PRISMA again.';
check('rule inert without peptide context', termOf(noPeptide, 'PRISMA') !== null);

console.log('\n' + (pass ? 'ALL PEPTIDE TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(pass ? 0 : 1);
