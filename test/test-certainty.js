'use strict';
// Certainty of meanings: probable meanings from the words before a bracket,
// definitions from the user's other papers (and their switch), and the line
// in the tooltip that says where a meaning comes from.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const LIBRARY = '/zotero/abbreviation-helper/library-definitions.json';

function makeEnv(files, prefs) {
  const FS = Object.assign({}, files);
  const P = new Map(Object.entries(prefs || {}));
  const io = {
    async exists(p) { return Object.prototype.hasOwnProperty.call(FS, p); },
    async makeDirectory() {},
    async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT'); return FS[p]; },
    async writeUTF8(p, s) { FS[p] = s; }
  };
  const sb = {
    globalThis: {}, console, IOUtils: io,
    setInterval, clearInterval, setTimeout, clearTimeout,
    fetch: async (u) => ({ ok: u.endsWith('data/abbreviations.json'), json: async () => bundled }),
    Zotero: {
      debug() {}, alert() {}, DataDirectory: { dir: '/zotero' },
      Prefs: { get: (k) => P.get(k), set: (k, v) => P.set(k, v) },
      File: { reveal() {} }, launchFile() {}
    }
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8') + '\n;this.__H=AbbreviationHelper;', sb);
  return { H: sb.__H, sb, FS, P };
}

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };

(async () => {
  const { sb } = makeEnv({});
  const dicts = { staticDefs: bundled.staticDefs, commonKnownDefs: bundled.commonKnownDefs };
  const find = (text, sf, extra) => sb.detectAbbreviations(text, Object.assign({}, dicts, extra)).find(p => p.abbr === sf);

  // ---------- 1. the words before a bracket ----------
  const atf = find('Stress activates translation of a cytoprotective transcription factor (ATF4). '
    + 'ATF4 then drives the response. Without ATF4 cells die.', 'ATF4');
  check('words before a first bracket give a probable meaning',
    atf && atf.certainty === 'probable' && /^cytoprotective transcription factor \(probable meaning/.test(atf.term), '-> ' + (atf && atf.term));
  const later = find('ATF4 is induced early. Stress activates translation of a cytoprotective transcription factor (ATF4). '
    + 'ATF4 rose.', 'ATF4');
  check('not where the abbreviation was used before its bracket', !later, '-> ' + (later && later.term));
  const pbs = find('Cells were washed in ice-cold buffer (PBS) twice. PBS was then removed.', 'PBS');
  check('a meaning the glossary holds in every field wins over the words before the bracket',
    pbs && pbs.certainty === 'common', '-> ' + (pbs && pbs.term));
  const defined = find('We used dithiothreitol (DTT). DTT was fresh.', 'DTT');
  check('a definition the letters confirm stays "defined"', defined && defined.certainty === 'defined' && defined.term === 'dithiothreitol');

  // ---------- 2. definitions from the user's other papers ----------
  const library = { XQZ: [{ term: 'xylose quinone zymase', papers: 2 }] };
  const lib = find('The xylose and quinone levels and zymase activity changed. XQZ rose. XQZ fell.', 'XQZ', { library });
  check('an undefined abbreviation gets the meaning other papers give',
    lib && lib.certainty === 'library' && lib.term === 'xylose quinone zymase (from 2 other papers in your library)', '-> ' + (lib && lib.term));
  const offTopic = find('Nothing in common here. XQZ rose. XQZ fell.', 'XQZ', { library });
  check('not when the paper never mentions what the meaning is about', !offTopic, '-> ' + (offTopic && offTopic.term));
  const own = find('The xylose quinone zymase pathway and a modified enzyme (XQZ) were used. XQZ rose. XQZ fell.', 'XQZ', { library });
  check('the paper\'s own words win over the library', own && own.certainty !== 'library', '-> ' + (own && own.term));
  const mhc = find('Myosin heavy chain isoforms in muscle fibres differ. MHC I is slow. MHC II is fast.', 'MHC',
    { library: { MHC: [{ term: 'myosin heavy chains', papers: 3 }] } });
  check('for a field-dependent glossary entry the library picks the field\'s meaning',
    mhc && mhc.certainty === 'library' && /^myosin heavy chain \(from 3 other papers/.test(mhc.term), '-> ' + (mhc && mhc.term));
  const dna = find('DNA was extracted. DNA was sequenced.', 'DNA', { library: { DNA: [{ term: 'dynamic nuclear assay', papers: 1 }] } });
  check('a meaning the glossary holds in every field is not second-guessed', dna && dna.certainty === 'common', '-> ' + (dna && dna.term));

  // ---------- 3. the plugin learns from one paper and uses it in another ----------
  const paperA = 'We measured the zinc zap tool (ZZT) in all samples. ZZT rose sharply.';
  const paperB = 'The zinc level and the zap of the tool were low. ZZT was stable. ZZT again.';
  let env = makeEnv({});
  env.H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await env.H._dictionariesReady; await env.H._libraryReady;
  env.H._detectAbbreviations(paperA, { libraryID: 1, key: 'AAAA1111' });
  const b = env.H._detectAbbreviations(paperB, { libraryID: 1, key: 'BBBB2222' }).find(p => p.abbr === 'ZZT');
  check('a definition from another paper is used', b && b.certainty === 'library' && /^zinc zap tool \(from another paper/.test(b.term), '-> ' + (b && b.term));
  env.H._flushLibrary();
  await new Promise(r => setTimeout(r, 10));
  const saved = JSON.parse(env.FS[LIBRARY] || '{}');
  check('definitions are kept in a file next to the abbreviations file', !!(saved.items && saved.items['1/AAAA1111/AAAA1111']));
  // The same paper, read again without its definition: only its own entry
  // knows ZZT, and a paper is never its own library.
  const a2 = env.H._detectAbbreviations('ZZT is mentioned here. ZZT twice. zinc zap tool words.', { libraryID: 1, key: 'AAAA1111' })
    .find(p => p.abbr === 'ZZT');
  check('a paper is never its own library', !a2 || a2.certainty !== 'library', '-> ' + (a2 && a2.term));

  env = makeEnv({ [LIBRARY]: JSON.stringify(saved) }, { 'extensions.abbreviation-helper.useLibraryDefinitions': false });
  env.H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await env.H._dictionariesReady; await env.H._libraryReady;
  const off = env.H._detectAbbreviations(paperB, { libraryID: 1, key: 'BBBB2222' }).find(p => p.abbr === 'ZZT');
  check('with the setting off, other papers are not used', !off, '-> ' + (off && off.term));
  env.H._detectAbbreviations('A new tool (NTL) was used. NTL twice.', { libraryID: 1, key: 'CCCC3333' });
  env.H._flushLibrary();
  await new Promise(r => setTimeout(r, 10));
  check('with the setting off, nothing is learned', !JSON.parse(env.FS[LIBRARY]).items['1/CCCC3333/CCCC3333']);

  // ---------- 4. the tooltip says where a meaning comes from ----------
  env = makeEnv({});
  const origin = t => env.H._meaningAndOrigin(t);
  check('tooltip: defined in this paper', origin('zinc zap tool').origin === 'Defined in this paper');
  check('tooltip: common term', origin('deoxyribonucleic acid (common term; not explicitly defined in this paper)').meaning === 'deoxyribonucleic acid'
    && /^Common term/.test(origin('deoxyribonucleic acid (common term; not explicitly defined in this paper)').origin));
  check('tooltip: from the library', origin('zinc zap tool (from 2 other papers in your library)').origin === 'From 2 other papers in your library');
  check('tooltip: probable', /^Probable meaning/.test(origin(atf.term).origin) && origin(atf.term).meaning === 'cytoprotective transcription factor');
  check('tooltip: your own definition', env.H._meaningAndOrigin('my meaning', 'user').origin === 'Your own definition');
  check('tooltip: a paper\'s meaning that matches one of yours is still the paper\'s',
    env.H._meaningAndOrigin('my meaning', 'defined').origin === 'Defined in this paper');

  console.log('\n' + (pass ? 'ALL CERTAINTY TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
