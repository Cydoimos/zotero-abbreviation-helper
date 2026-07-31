'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');

const prefStore = new Map();
const revealed = [];
const alerts = [];
const mockZotero = {
  debug() {},
  Prefs: {
    get(k, g) { return prefStore.has(k) ? prefStore.get(k) : undefined; },
    set(k, v, g) { prefStore.set(k, v); }
  },
  DataDirectory: { dir: '/home/user/Zotero' },
  File: { reveal(p) { revealed.push(p); } },
  launchFile(p) { revealed.push('launch:' + p); },
  alert(w, t, m) { alerts.push(m); }
};
// IOUtils mock: pretend file does not exist, capture writes.
const writes = [];
global.IOUtils = {
  async exists(p) { return false; },
  async makeDirectory(p, o) { return; },
  async writeUTF8(p, s) { writes.push(p); },
  async readUTF8(p) { return '{}'; }
};

const code = fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8');
const sandbox = { globalThis: {}, Zotero: mockZotero, console, IOUtils: global.IOUtils };
vm.createContext(sandbox);
vm.runInContext(code + '\n;this.__H = AbbreviationHelper;', sandbox);
const H = sandbox.__H;

let pass = true;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name); if (!cond) pass = false; }

// 1) Defaults + fallback when nothing saved
H.hoverEnabled = true; H.tooltipModifier = 'none';
check('_getPref returns fallback when unset', H._getPref('tooltipModifier', 'none') === 'none');

// 2) Save then restore
H.tooltipModifier = 'ctrl';
H._setPref('tooltipModifier', H.tooltipModifier);
H.databaseLinksModifier = 'none';
H._setPref('databaseLinksModifier', H.databaseLinksModifier);
check('pref persisted to store', prefStore.get('extensions.abbreviation-helper.tooltipModifier') === 'ctrl');

// Simulate a restart: reset in-memory fields to code defaults, then _loadPrefs()
H.tooltipModifier = 'none';
H.databaseLinksModifier = 'shift';
H.hoverEnabled = true;
H._loadPrefs();
check('tooltipModifier restored to saved ctrl', H.tooltipModifier === 'ctrl');
check('databaseLinksModifier restored to saved none', H.databaseLinksModifier === 'none');
check('hoverEnabled restored (still default true, unset)', H.hoverEnabled === true);

// 3) Path + open file flow
check('_userDictionaryPath is correct', H._userDictionaryPath() === '/home/user/Zotero/abbreviation-helper/abbreviations.json');

H.dictionaries = require('../src/data/abbreviations.json');
H._dictionariesReady = Promise.resolve(H.dictionaries);
(async () => {
  await H._openUserDictionary({});
  check('open created the file (write happened)', writes.length === 1 && writes[0].endsWith('abbreviation-helper/abbreviations.json'));
  check('open revealed the file', revealed.length === 1 && revealed[0].endsWith('abbreviations.json'));
  console.log('\n' + (pass ? 'ALL PREF/OPEN TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})();
