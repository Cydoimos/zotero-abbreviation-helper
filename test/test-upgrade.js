'use strict';
/* Updating from 2.1.0: the new version starts on what a 2.1.0 user has on
 * disk (their preferences and the abbreviations file 2.1.0 created, with
 * their own entries) and must carry all of it over unchanged. bootstrap.js
 * and abbreviation.js are the real files; Zotero is faked. */
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const USER = '/zotero/abbreviation-helper/abbreviations.json';
const LIBRARY = '/zotero/abbreviation-helper/library-definitions.json';
const BRANCH = 'extensions.abbreviation-helper.';

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const wait = ms => new Promise(r => setTimeout(r, ms));

// The file 2.1.0 creates on first run (its _starterUserConfig), with the
// entries a user then added in its Settings pane.
const FILE_FROM_2_1_0 = JSON.stringify({
  _comment: 'Your Abbreviation Helper settings. Most of this can be edited in Zotero Settings -> Abbreviation '
    + 'Helper. If you edit here instead, save the file and then use Reload from file in that pane. userDefs:   '
    + '"ABC": "your meaning"  - always shown, wins over the paper. ignore:     ["NEB"]                - never '
    + 'show these. databases:  [{"group":"Gene/protein databases","label":"UniProt",              "url":'
    + '"https://www.uniprot.org/uniprotkb?query={q}","enabled":true}]             {q} = token without hyphens, '
    + '{raw} = token as written.             A non-empty list here REPLACES the built-in databases.',
  userDefs: { MSA: 'mannitol salt agar' },
  ignore: ['NEB'],
  databases: []
}, null, 2);

// Preferences as 2.1.0 stores them. The Settings pane's size list stores a
// string, the Tools menu a number; both must still work.
const PREFS_FROM_2_1_0 = {
  hoverEnabled: true, tooltipModifier: 'shift', databaseLinksEnabled: true,
  databaseLinksModifier: 'ctrl', databaseLinksOnAbbreviations: false,
  tooltipFontSize: '16', tooltipTheme: 'light',
  disabledDatabases: 'ATCC|GeneCards', enabledDatabases: '', advancedMenu: true
};

function start(files, prefs) {
  const FS = Object.assign({}, files);
  const P = new Map(Object.entries(prefs).map(([k, v]) => [BRANCH + k, v]));
  const tools = { id: 'menu_ToolsPopup', childNodes: [], appendChild(c) { this.childNodes.push(c); return c; } };
  const el = tag => ({ tagName: tag, childNodes: [], _attrs: {}, setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; }, appendChild(c) { this.childNodes.push(c); return c; },
    removeChild() {}, remove() {}, addEventListener() {}, get firstChild() { return this.childNodes[0] || null; } });
  const doc = { getElementById: id => id === 'menu_ToolsPopup' ? tools : (tools.childNodes.find(c => c.id === id) || null),
    createXULElement: el };
  const window = { document: doc, ZoteroPane: {}, Zotero_Tabs: { selectedType: 'library' } };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => bundled }),
    IOUtils: {
      async exists(p) { return p in FS; }, async makeDirectory() {},
      async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT'); return FS[p]; },
      async writeUTF8(p, s) { FS[p] = s; }, async remove(p) { delete FS[p]; }
    },
    Zotero: {
      debug() {}, alert() {}, DataDirectory: { dir: '/zotero' },
      Prefs: { get: k => P.get(k), set: (k, v) => P.set(k, v) },
      getMainWindows: () => [window], getMainWindow: () => window,
      getActiveZoteroPane: () => ({ getSelectedItems: () => [] }),
      Promise: { delay: ms => wait(ms) },
      PreferencePanes: { register: () => 'pane', unregister() {} },
      Notifier: { registerObserver: () => 'obs', unregisterObserver() {} }
    },
    Services: {
      scriptloader: { loadSubScript(url) { vm.runInContext(fs.readFileSync(SRC_DIR + '/' + url.replace('r://', ''), 'utf8'), sandbox); } },
      prefs: { getBranch: () => ({ addObserver() {}, removeObserver() {} }) }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/bootstrap.js', 'utf8'), sandbox);
  return { sandbox, FS, P };
}

(async () => {
  const z = start({ [USER]: FILE_FROM_2_1_0 }, PREFS_FROM_2_1_0);
  await z.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: 'new', rootURI: 'r://' });
  const H = z.sandbox.AbbreviationHelper;
  await H._dictionariesReady; await H._libraryReady;
  await wait(20);

  // ---------- settings carry over ----------
  check('modifier keys are kept', H.tooltipModifier === 'shift' && H.databaseLinksModifier === 'ctrl');
  check('text size stored as text by 2.1.0 still works', H.tooltipFontSize === 16, String(H.tooltipFontSize));
  check('theme and link options are kept', H.tooltipTheme === 'light' && H.databaseLinksOnAbbreviations === false);
  check('the old switch for a shorter Tools menu is left unused: the menu has every setting now',
    !('advancedMenu' in H));
  const on = H._enabledDatabases().map(d => d.label);
  check('databases switched off stay off', !on.includes('ATCC') && !on.includes('GeneCards'), on.join(','));
  check('the others stay on', ['HGNC', 'UniProt', 'NCBI Gene', 'Cellosaurus', 'PubChem'].every(l => on.includes(l)));
  check('the new databases start off', !['Ensembl', 'InterPro', 'RCSB PDB', 'RNAcentral', 'Addgene'].some(l => on.includes(l)));
  check('new settings take their defaults', H.useLibraryDefinitions === true && H.showMeaningSource === true
    && H.usesEnabled === false && H.usesCount === 3);
  check('the version is recorded', z.P.get(BRANCH + 'lastVersion') === 'new');

  // Database links were on by default in 2.1.0 and are off for a new install
  // now. Someone who never touched the setting must keep them.
  {
    const { databaseLinksEnabled, ...untouched } = PREFS_FROM_2_1_0;
    const kept = start({ [USER]: FILE_FROM_2_1_0 }, untouched);
    await kept.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: '2.2.0', rootURI: 'r://' });
    const K = kept.sandbox.AbbreviationHelper;
    await K._dictionariesReady;
    check('updating from 2.1.0 keeps database links on, though the default is now off',
      K.databaseLinksEnabled === true && kept.P.get(BRANCH + 'databaseLinksEnabled') === true
      && K._enabledDatabases().length > 0);
    kept.sandbox.shutdown();

    const off = start({ [USER]: FILE_FROM_2_1_0 }, Object.assign({}, untouched, { databaseLinksEnabled: false }));
    await off.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: '2.2.0', rootURI: 'r://' });
    await off.sandbox.AbbreviationHelper._dictionariesReady;
    check('links switched off in 2.1.0 stay off', off.sandbox.AbbreviationHelper.databaseLinksEnabled === false);
    off.sandbox.shutdown();

    const fresh = start({}, {});
    await fresh.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: '2.2.0', rootURI: 'r://' });
    const F = fresh.sandbox.AbbreviationHelper;
    await F._dictionariesReady;
    check('a new install starts with only meanings on', F.hoverEnabled === true && F.databaseLinksEnabled === false
      && F.usesEnabled === false && !fresh.P.has(BRANCH + 'databaseLinksEnabled'));
    check('and makes its abbreviations file, as before', USER in fresh.FS);
    fresh.sandbox.shutdown();
    // Its second start finds that file, but knows it made it itself.
    const again = start(fresh.FS, Object.fromEntries([...fresh.P].map(([k, v]) => [k.replace(BRANCH, ''), v])));
    await again.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: '2.2.0', rootURI: 'r://' });
    await again.sandbox.AbbreviationHelper._dictionariesReady;
    check('and keeps them so on the next start', again.sandbox.AbbreviationHelper.databaseLinksEnabled === false);
    again.sandbox.shutdown();
  }
  // This user holds Ctrl for database links, so "where a word is used" must
  // not take Ctrl, its default: the links would no longer show.
  check('where a word is used keeps off the key the links use, and the settings show it',
    H.usesModifier === 'alt' && z.P.get(BRANCH + 'usesModifier') === 'alt', H.usesModifier);
  {
    const free = start({}, { tooltipModifier: 'none', databaseLinksModifier: 'shift' });
    await free.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: 'new', rootURI: 'r://' });
    const F = free.sandbox.AbbreviationHelper;
    check('with the usual keys it takes Ctrl, and saves nothing',
      F.usesModifier === 'ctrl' && !free.P.has(BRANCH + 'usesModifier'));
    free.sandbox.shutdown();
    const ctrl = start({}, { tooltipModifier: 'none', databaseLinksModifier: 'ctrl' });
    await ctrl.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: 'new', rootURI: 'r://' });
    check('with only Ctrl taken it takes Shift', ctrl.sandbox.AbbreviationHelper.usesModifier === 'shift');
    ctrl.sandbox.shutdown();
    const mine = start({}, { tooltipModifier: 'ctrl', databaseLinksModifier: 'shift', usesModifier: 'ctrl' });
    await mine.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: 'new', rootURI: 'r://' });
    check('a key picked on purpose is kept', mine.sandbox.AbbreviationHelper.usesModifier === 'ctrl');
    mine.sandbox.shutdown();
  }

  // ---------- the abbreviations file carries over ----------
  check('the file is read without complaint', H.userFileError === null, String(H.userFileError));
  check('starting up does not rewrite it', z.FS[USER] === FILE_FROM_2_1_0);
  check('your own definitions are in use', H._userDefinitions().MSA === 'mannitol salt agar');
  check('your ignore list is in use', H._ignoreList().includes('NEB'));
  const pairs = H._detectAbbreviations('Plates of MSA were used. MSA again. New England Biolabs (NEB) kit. NEB twice.');
  check('a paper using them shows your meaning and hides the ignored one',
    pairs.some(p => p.abbr === 'MSA' && p.term === 'mannitol salt agar') && !pairs.some(p => p.abbr === 'NEB'),
    JSON.stringify(pairs.map(p => p.abbr)));
  check('no file of learned definitions is made before a paper is opened', !(LIBRARY in z.FS));

  // A change made in the new Settings pane keeps what 2.1.0 wrote.
  await H._setUserDefinition('LB', 'lysogeny broth');
  const after = JSON.parse(z.FS[USER]);
  check('a change keeps the existing entries', after.userDefs.MSA === 'mannitol salt agar'
    && after.userDefs.LB === 'lysogeny broth' && after.ignore.includes('NEB') && Array.isArray(after.databases));

  // ---------- leftovers of the old version ----------
  const old = { id: 'abbreviation-helper-tooltip', dataset: {}, parentNode: null };
  const page = { body: { appendChild(c) { c.parentNode = this; return c; }, removeChild(c) { c.parentNode = null; } },
    getElementById: id => (id === old.id && old.parentNode ? old : null), createElement: () => ({ style: {}, dataset: {},
      setAttribute() {}, addEventListener() {} }) };
  page.body.appendChild(old);
  H._ensureHoverTooltip(page);
  check('a tooltip left in an open tab by 2.1.0 is replaced, not reused', old.parentNode === null);

  // ---------- a hand-edited file 2.1.0 could not read either ----------
  const broken = '{\n  // my notes\n  "userDefs": { "MSA": "mannitol salt agar" }\n}';
  const b = start({ [USER]: broken }, PREFS_FROM_2_1_0);
  await b.sandbox.startup({ id: 'abbreviation-helper@cydoimos.github.io', version: 'new', rootURI: 'r://' });
  const HB = b.sandbox.AbbreviationHelper;
  await HB._dictionariesReady;
  let refused = false;
  try { await HB._setUserDefinition('LB', 'lysogeny broth'); } catch (e) { refused = true; }
  check('a file with comments is reported, and never overwritten', !!HB.userFileError && refused && b.FS[USER] === broken);

  z.sandbox.shutdown(); b.sandbox.shutdown();
  console.log('\n' + (pass ? 'ALL UPGRADE TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
