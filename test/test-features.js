'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Tests for the menu-facing features: authoritative user definitions, the
 * ignore list, configurable modifier keys, and config-driven databases. */
const fs = require('fs'), vm = require('vm');
const ROOT = __dirname;
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const USER = '/zotero/abbreviation-helper/abbreviations.json';

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
  return { H: sb.__H, FS, P };
}

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };

(async () => {
  // ---------- 1. user definitions are authoritative ----------
  // The long form aligns with the short form, so the detector finds it on its
  // own; that is what makes it a fair test of the user override.
  const paper = 'We measured the zinc zap tool (ZZT) in all samples. ZZT rose sharply. ZZT again later.';
  let { H } = makeEnv({});
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  const before = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('without a user entry, the paper text is used', /zinc zap tool/.test(before.get('ZZT') || ''), '-> ' + before.get('ZZT'));

  ({ H } = makeEnv({ [USER]: JSON.stringify({ userDefs: { ZZT: 'my authoritative meaning' } }) }));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  const after = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('user entry overrides the paper', after.get('ZZT') === 'my authoritative meaning', '-> ' + after.get('ZZT'));

  // A user entry for something absent from the paper must not be injected.
  ({ H } = makeEnv({ [USER]: JSON.stringify({ userDefs: { NOTHERE: 'unused' } }) }));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  const abs = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('unused user entry is not injected', !abs.has('NOTHERE'));

  // ---------- 2. ignore list ----------
  ({ H } = makeEnv({ [USER]: JSON.stringify({ ignore: ['ZZT'] }) }));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  const ign = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('ignored abbreviation is suppressed', !ign.has('ZZT'));

  // Writing to the ignore list persists and survives reload.
  let env = makeEnv({});
  H = env.H;
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  await H._updateUserConfig({ ignore: ['NEB'] });
  await H._reloadDictionaries(null);
  check('ignore write persists to disk', /NEB/.test(env.FS[USER] || ''));
  check('ignore list is live after reload', (H.dictionaries.ignore || []).indexOf('NEB') !== -1);

  // ---------- 2b. removing entries again (the round trip) ----------
  await H._updateUserConfig({ ignore: ['PTEN'] });
  await H._reloadDictionaries(null);
  check('second entry added', H._ignoreList().sort().join(',') === 'NEB,PTEN', H._ignoreList().join(','));

  await H._stopIgnoring('NEB');
  check('un-ignoring removes just that entry', H._ignoreList().join(',') === 'PTEN', H._ignoreList().join(','));
  check('removal is written to disk, not only in memory',
    (JSON.parse(env.FS[USER]).ignore || []).join(',') === 'PTEN');

  // A previously ignored abbreviation is detected again afterwards.
  const revived = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  await H._stopIgnoring('PTEN');
  check('clearing the last entry leaves an empty list', H._ignoreList().length === 0);

  await H._updateUserConfig({ ignore: ['ZZT'] });
  await H._reloadDictionaries(null);
  const hidden = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('re-ignored abbreviation disappears again', !hidden.has('ZZT'));
  await H._stopIgnoring('ZZT');
  const back = new Map(H._detectAbbreviations(paper).map(p => [p.abbr, p.term]));
  check('and comes back once un-ignored', back.has('ZZT'), '-> ' + back.get('ZZT'));

  await H._updateUserConfig({ ignore: ['A', 'B', 'C'] });
  await H._reloadDictionaries(null);
  await H._setIgnoreList([]);
  check('stop ignoring all empties the list', H._ignoreList().length === 0);
  check('empty list is persisted', (JSON.parse(env.FS[USER]).ignore || []).length === 0);

  // ---------- 3. starter file is empty, not a copy of the defaults ----------
  env = makeEnv({});
  env.H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await env.H._dictionariesReady;
  const starter = JSON.parse(env.FS[USER]);
  check('starter file has no copied staticDefs', !starter.staticDefs || Object.keys(starter.staticDefs).length === 0);
  check('starter file exposes the editable sections',
    !!starter.userDefs && Array.isArray(starter.ignore) && Array.isArray(starter.databases));
  check('starter file is small', env.FS[USER].length < 1500, env.FS[USER].length + ' bytes');

  // ---------- 4. modifier keys ----------
  ({ H } = makeEnv({}));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  H.modifierState = { shift: false, ctrl: false, alt: false, meta: false };
  H.databaseLinksModifier = 'shift';
  check('shift required and not held -> blocked', H._databaseLinksCurrentlyAllowed() === false);
  H._updateModifierState({ shiftKey: true });
  check('shift required and held -> allowed', H._databaseLinksCurrentlyAllowed() === true);
  H.databaseLinksModifier = 'none';
  H._updateModifierState({});
  check('no modifier configured -> always allowed', H._databaseLinksCurrentlyAllowed() === true);
  H.databaseLinksModifier = 'ctrl';
  H._updateModifierState({ metaKey: true });
  check('ctrl setting also accepts Command on macOS', H._databaseLinksCurrentlyAllowed() === true);
  H.databaseLinksModifier = 'alt';
  H._updateModifierState({ shiftKey: true });
  check('wrong modifier held -> blocked', H._databaseLinksCurrentlyAllowed() === false);

  // ---------- 4b. platform labelling (Ctrl == Cmd on macOS) ----------
  ({ H } = makeEnv({}));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  H._isMac = () => false;
  let choices = H._modifierChoices();
  check('non-Mac labels the key Ctrl',
    choices.find(c => c.id === 'ctrl').label === 'Ctrl');
  check('non-Mac labels the key Alt',
    choices.find(c => c.id === 'alt').label === 'Alt');
  H._isMac = () => true;
  choices = H._modifierChoices();
  check('macOS label mentions Command',
    /Command/.test(choices.find(c => c.id === 'ctrl').label),
    choices.find(c => c.id === 'ctrl').label);
  check('macOS label mentions Option',
    /Option/.test(choices.find(c => c.id === 'alt').label),
    choices.find(c => c.id === 'alt').label);
  // The behaviour must match the labelling on every platform.
  H.databaseLinksModifier = 'ctrl';
  H._updateModifierState({ ctrlKey: true });
  check('Control satisfies the ctrl setting', H._databaseLinksCurrentlyAllowed() === true);
  H._updateModifierState({ metaKey: true });
  check('Command satisfies the ctrl setting', H._databaseLinksCurrentlyAllowed() === true);

  // ---------- 4c. paths work on both separator conventions ----------
  check('POSIX data directory path',
    H._joinPath('/home/u/Zotero', 'abbreviation-helper', 'abbreviations.json')
      === '/home/u/Zotero/abbreviation-helper/abbreviations.json');
  check('Windows data directory path',
    H._joinPath('C:\\Users\\u\\Zotero', 'abbreviation-helper', 'abbreviations.json')
      === 'C:\\Users\\u\\Zotero\\abbreviation-helper\\abbreviations.json');
  check('trailing separator does not double up',
    H._joinPath('/home/u/Zotero/', 'x') === '/home/u/Zotero/x');

  // ---------- 5. databases from config ----------
  ({ H } = makeEnv({}));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  let info = H._lookupDatabaseLinks('EGFR');
  const labels = info.groups.flatMap(g => g.links.map(l => l.label));
  check('all configured databases offered', labels.length === bundled.databases.length, labels.join(','));
  check('URL placeholders expanded', info.groups[0].links[0].url.indexOf('{q}') === -1);

  // Disabling one from the menu removes it.
  H._setDatabaseEnabled('GeneCards', false);
  info = H._lookupDatabaseLinks('EGFR');
  const after2 = info.groups.flatMap(g => g.links.map(l => l.label));
  check('disabled database is removed', after2.indexOf('GeneCards') === -1 && after2.length === labels.length - 1);

  // A user-supplied list replaces the built-ins entirely.
  ({ H } = makeEnv({ [USER]: JSON.stringify({
    databases: [{ group: 'My databases', label: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/?term={raw}', enabled: true }]
  }) }));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  info = H._lookupDatabaseLinks('EGFR');
  const custom = info.groups.flatMap(g => g.links.map(l => l.label));
  check('user database list replaces the defaults', custom.length === 1 && custom[0] === 'PubMed', custom.join(','));
  check('custom group label used', info.groups[0].groupLabel === 'My databases');

  // ---------- 6. stability ----------
  ({ H } = makeEnv({}));
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  for (let i = 0; i < H.CACHE_LIMIT + 25; i++) H._cacheResult(i, [{ abbr: 'X' + i, term: 't' }]);
  check('scan cache is bounded', H.cache.size === H.CACHE_LIMIT, 'size=' + H.cache.size);
  check('cache keeps the most recent entries', H.cache.has(H.CACHE_LIMIT + 24) && !H.cache.has(0));

  // The startup timeout must be cancellable, so disabling the plugin early
  // cannot leave a scan pending after shutdown.
  H._startAutoScanTimer();
  check('startup scan timer is tracked', H.autoScanTimer !== null && H.autoScanFirstRun !== null);
  H._stopAutoScanTimer();
  check('stopping clears both timers', H.autoScanTimer === null && H.autoScanFirstRun === null);

  console.log('\n' + (pass ? 'ALL FEATURE TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})();
