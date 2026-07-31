'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* End-to-end test of the user-editable dictionary: first-run creation, reading
 * user entries, override precedence over bundled defaults, effect on detection,
 * and hot reload. Uses an in-memory fake filesystem. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = __dirname;
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));

function makeEnv(files) {
  const FS = Object.assign({}, files);
  const io = {
    async exists(p) { return Object.prototype.hasOwnProperty.call(FS, p); },
    async makeDirectory() {},
    async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT ' + p); return FS[p]; },
    async writeUTF8(p, s) { FS[p] = s; }
  };
  const sb = {
    globalThis: {}, console, IOUtils: io,
    fetch: async (url) => ({ ok: url.endsWith('data/abbreviations.json'), json: async () => bundled }),
    Zotero: {
      debug() {}, alert() {},
      DataDirectory: { dir: '/zotero' },
      Prefs: { get() { return undefined; }, set() {} },
      File: { reveal() {} }, launchFile() {}
    }
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8') + '\n;this.__H=AbbreviationHelper;', sb);
  return { H: sb.__H, FS };
}

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const USER = '/zotero/abbreviation-helper/abbreviations.json';

(async () => {
  // ---- 1) First run: the file is created ---------------------------------
  let { H, FS } = makeEnv({});
  H.init({ id: 'x', version: '1', rootURI: 'res://plugin/' });
  await H._dictionariesReady;
  check('first run creates the user file', !!FS[USER]);
  let created = FS[USER] ? JSON.parse(FS[USER]) : null;
  // The starter file is intentionally EMPTY (userDefs/ignore/databases only):
  // copying the bundled dictionary into it would bury the user's own entries
  // and permanently shadow later improvements to the shipped defaults.
  check('created file exposes the editable sections',
    !!created && !!created.userDefs && Array.isArray(created.ignore) && Array.isArray(created.databases));
  check('created file does not copy the bundled dictionary',
    !created.staticDefs || Object.keys(created.staticDefs).length === 0);
  // Compare with the shipped file rather than a fixed number, so trimming the
  // dictionary later cannot silently invalidate this test.
  const BUNDLED_N = Object.keys(bundled.staticDefs).length;
  check('bundled dictionary still loaded',
    Object.keys(H.dictionaries.staticDefs).length === BUNDLED_N,
    'n=' + Object.keys(H.dictionaries.staticDefs).length + ' of ' + BUNDLED_N);

  // ---- 2) User entries are picked up and win over the bundled defaults ----
  const userFile = JSON.stringify({
    staticDefs: { 'ZZTOP': 'my custom widget', 'PDT': 'photodynamic therapy OVERRIDDEN' },
    commonKnownDefs: { 'QQQ': [{ term: 'my glossary entry', ambiguity: 'low' }] }
  });
  ({ H, FS } = makeEnv({ [USER]: userFile }));
  H.init({ id: 'x', version: '1', rootURI: 'res://plugin/' });
  await H._dictionariesReady;
  check('user entry is loaded', H.dictionaries.staticDefs['ZZTOP'] === 'my custom widget');
  check('user entry overrides bundled default',
    H.dictionaries.staticDefs['PDT'] === 'photodynamic therapy OVERRIDDEN',
    '-> ' + H.dictionaries.staticDefs['PDT']);
  check('bundled entries survive alongside user entries',
    H.dictionaries.staticDefs['EGFR'] === 'epidermal growth factor receptor');
  check('user glossary entry is loaded', !!H.dictionaries.commonKnownDefs['QQQ']);

  // ---- 3) A user entry actually changes detection -------------------------
  const text = 'We measured the widget of interest (ZZTOP) in all samples. ZZTOP values rose. ZZTOP again.';
  const got = new Map(H._detectAbbreviations(text).map(p => [p.abbr, p.term]));
  check('custom entry participates in detection', got.has('ZZTOP'), '-> ' + got.get('ZZTOP'));

  // ---- 4) Malformed user file must not break the plugin -------------------
  ({ H, FS } = makeEnv({ [USER]: '{ this is not valid json' }));
  H.init({ id: 'x', version: '1', rootURI: 'res://plugin/' });
  await H._dictionariesReady;
  check('malformed user file falls back to bundled defaults',
    Object.keys(H.dictionaries.staticDefs).length === Object.keys(bundled.staticDefs).length,
    'n=' + Object.keys(H.dictionaries.staticDefs).length);

  // ---- 5) Hot reload picks up edits without a restart ---------------------
  ({ H, FS } = makeEnv({ [USER]: JSON.stringify({ staticDefs: {}, commonKnownDefs: {} }) }));
  H.init({ id: 'x', version: '1', rootURI: 'res://plugin/' });
  await H._dictionariesReady;
  check('before edit, custom entry absent', !H.dictionaries.staticDefs['LATER']);
  FS[USER] = JSON.stringify({ staticDefs: { 'LATER': 'added after startup' }, commonKnownDefs: {} });
  await H._reloadDictionaries(null);
  check('reload picks up the edit', H.dictionaries.staticDefs['LATER'] === 'added after startup');

  console.log('\n' + (pass ? 'ALL USER-DICTIONARY TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})();
