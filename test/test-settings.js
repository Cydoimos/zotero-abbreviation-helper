'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Tests for the Settings pane: that every control in settings.xhtml is wired to
 * something real, that the dynamic lists build from the abbreviations file,
 * and that toggling a database from the pane actually takes effect.
 *
 * The pane markup is parsed rather than hand-built, so a control renamed in
 * settings.xhtml but not in settings.js shows up here as a failure. */
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const XHTML = fs.readFileSync(SRC_DIR + '/settings.xhtml', 'utf8');
const USER = '/zotero/abbreviation-helper/abbreviations.json';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/* ---- fake DOM ----------------------------------------------------------- */
function makeEl(tag, doc) {
  const el = {
    tagName: tag, id: '', parentNode: null, childNodes: [], textContent: '',
    disabled: false, checked: false, defaultChecked: false, value: '', style: {},
    _attrs: {}, _listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) {
      this._attrs[k] = String(v);
      if (k === 'id') { this.id = String(v); doc._store[this.id] = this; }
      if (k === 'checked') this.checked = String(v) === 'true';
      if (k === 'value') this.value = String(v);
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.id) doc._store[c.id] = c; return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    fire(t) { for (const fn of (this._listeners[t] || []).slice()) fn({ target: this }); },
    click() { this.fire('click'); },
    querySelector(sel) { return descend(this).find(e => e.tagName === sel) || null; },
    get firstChild() { return this.childNodes[0] || null; }
  };
  return el;
}
const descend = (el, out = []) => { for (const c of el.childNodes) { out.push(c); descend(c, out); } return out; };

/* Parse settings.xhtml well enough to reproduce its element tree: tag names,
 * attributes and nesting. Good enough to catch a renamed id. */
function parseFragment(xml, doc) {
  const root = makeEl('#root', doc);
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    // `html:th` in the fragment becomes an HTML element whose local name is
    // `th`, so drop the prefix to match what the real document produces.
    const el = makeEl(tag.replace(/^html:/, ''), doc);
    let a;
    while ((a = attrRe.exec(attrs))) {
      if (a[1].indexOf('xmlns') !== 0) el.setAttribute(a[1], a[2]);
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

function makeDoc() {
  const doc = { _store: {} };
  doc.createXULElement = (t) => makeEl(t, doc);
  doc.createElement = doc.createXULElement;
  doc.createElementNS = (ns, t) => makeEl(ns === HTML_NS ? t : t, doc);
  doc.getElementById = (id) => doc._store[id] || null;
  doc.defaultView = { openPreferences() {} };
  return doc;
}

/* ---- plugin under test -------------------------------------------------- */
function makeHelper(files, prefs) {
  const FS = Object.assign({}, files);
  const P = new Map(Object.entries(prefs || {}));
  const io = {
    async exists(p) { return Object.prototype.hasOwnProperty.call(FS, p); },
    async makeDirectory() {},
    async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT'); return FS[p]; },
    async writeUTF8(p, s) { FS[p] = s; }
  };
  const Z = {
    debug() {}, alert() {}, DataDirectory: { dir: '/zotero' },
    Prefs: { get: (k) => P.get(k), set: (k, v) => P.set(k, v) },
    File: { reveal() {} }, launchFile() {}
  };
  const sb = {
    globalThis: {}, console, IOUtils: io, Zotero: Z,
    setInterval, clearInterval, setTimeout, clearTimeout,
    fetch: async (u) => ({ ok: u.endsWith('data/abbreviations.json'), json: async () => bundled })
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8') + '\n;this.__H=AbbreviationHelper;', sb);
  return { H: sb.__H, Z, FS, P };
}

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const { H, Z, P } = makeHelper({});
  H.init({ id: 'abbreviation-helper@cydoimos.github.io', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;

  // ---------- 1. the plugin is reachable from the Settings window ----------
  // The pane is a separate document; Zotero is the only object both can see.
  check('plugin is exposed on Zotero for the pane', Z.AbbreviationHelper === H);

  // ---------- 2. every bound preference is one the plugin reads ----------
  const bound = [...XHTML.matchAll(/preference="([^"]+)"/g)].map(m => m[1]);
  check('pane binds some preferences', bound.length >= 6, bound.length + '');
  check('every bound preference uses the plugin branch',
    bound.every(p => p.indexOf(H.PREF_BRANCH) === 0),
    bound.filter(p => p.indexOf(H.PREF_BRANCH) !== 0).join(',') || 'all on branch');

  const readByPlugin = new Set(
    [...fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8')
      .matchAll(/_getPref\('([^']+)'/g)].map(m => m[1]));
  const boundNames = bound.map(p => p.slice(H.PREF_BRANCH.length));
  check('every bound preference is one the plugin actually loads',
    boundNames.every(n => readByPlugin.has(n)),
    boundNames.filter(n => !readByPlugin.has(n)).join(',') || 'all read');

  // ---------- 3. the pane initialises against the real markup ----------
  const doc = makeDoc();
  const frag = parseFragment(XHTML, doc);
  check('markup parsed', descend(frag).length > 20, descend(frag).length + ' elements');

  const prefsSandbox = {
    console, document: doc, Zotero: Z, Promise, setTimeout,
    window: doc.defaultView
  };
  vm.createContext(prefsSandbox);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/settings.js', 'utf8') + '\n;this.__P=AbbrevSettings;', prefsSandbox);
  const Pane = prefsSandbox.__P;
  Pane.init();

  // ---------- 4. modifier menus are filled, with platform labels ----------
  for (const id of ['abbrev-settings-tooltip-modifier', 'abbrev-settings-db-modifier']) {
    const list = doc.getElementById(id);
    const items = list ? descend(list).filter(e => e.tagName === 'menuitem') : [];
    check(id + ' is populated', items.length === 4, items.length + ' items');
    check(id + ' uses the same ids the plugin stores',
      items.map(i => i.getAttribute('value')).join(',') === 'none,shift,ctrl,alt');
  }

  // ---------- 4b. form controls use Zotero's native styling ----------
  // Firefox 115 needs native="true" for a XUL form element to be drawn as a
  // platform control; without it a menulist renders as a plain grey pill and
  // looks nothing like the rest of Zotero's settings.
  const menulists = descend(frag).filter(e => e.tagName === 'menulist');
  check('the pane has menulists', menulists.length === 4, menulists.length + '');
  check('every menulist is native',
    menulists.every(e => e.getAttribute('native') === 'true'),
    menulists.filter(e => e.getAttribute('native') !== 'true')
      .map(e => e.id).join(',') || 'all native');

  // ---------- 4c. tooltip sizes ----------
  const sizeList = doc.getElementById('abbrev-settings-font');
  const sizes = descend(sizeList).filter(e => e.tagName === 'menuitem')
    .map(e => Number(e.getAttribute('value')));
  check('five tooltip sizes are offered', sizes.length === 5, sizes.join(','));
  check('the range spans very small to very large',
    Math.min(...sizes) <= 10 && Math.max(...sizes) >= 20, sizes.join(','));
  check('sizes are in ascending order',
    sizes.slice(1).every((v, i) => v > sizes[i]), sizes.join(','));

  // The Tools menu offers the same list; a size available in one place but
  // not the other would be a setting the user could not get back to.
  const menuSizes = (fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8')
    .match(/\{ id: (\d+), label: '(?:Very small|Small|Medium|Large|Very large)' \}/g) || [])
    .map(s => Number(s.match(/\d+/)[0]));
  check('the Tools menu offers the same sizes',
    menuSizes.join(',') === sizes.join(','), menuSizes.join(',') + ' vs ' + sizes.join(','));

  // ---------- 5. databases are listed and can be toggled ----------
  // The list is a scrolling table: one row per database, a checkbox in the
  // first cell and the name in the second.
  const dbBox = doc.getElementById('abbrev-settings-db-list');
  const dbRows = dbBox.childNodes.filter(r =>
    r.tagName === 'tr' && !r.classList.contains('abbrev-settings-group-row')
    && !r.classList.contains('abbrev-settings-empty'));
  const dbOf = (row) => ({
    input: descend(row).find(e => e.tagName === 'checkbox'),
    label: row.childNodes[1] ? row.childNodes[1].textContent : ''
  });
  check('every database is listed', dbRows.length === bundled.databases.length,
    dbRows.length + ' of ' + bundled.databases.length);
  check('databases start checked', dbRows.every(r => dbOf(r).input.checked));
  check('group headings are shown',
    dbBox.childNodes.filter(r => r.classList.contains('abbrev-settings-group-row')).length >= 2);

  const uniprot = dbRows.map(dbOf).find(d => d.label === 'UniProt').input;
  uniprot.checked = false;                // what the widget does on click
  uniprot.fire('command');
  check('unchecking one in the pane disables it',
    H._enabledDatabases().map(d => d.label).indexOf('UniProt') === -1,
    H._enabledDatabases().map(d => d.label).join(','));
  uniprot.checked = true;
  uniprot.fire('command');
  check('rechecking re-enables it',
    H._enabledDatabases().map(d => d.label).indexOf('UniProt') !== -1);

  // ---------- 6. ignore list renders and clears ----------
  await H._updateUserConfig({ ignore: ['NEB', 'PTEN'] });
  await H._reloadDictionaries(null);
  Pane.refresh();
  const ignoreBox = doc.getElementById('abbrev-settings-ignore-list');
  const named = (body) => body.childNodes
    .filter(r => r.tagName === 'tr' && !r.classList.contains('abbrev-settings-empty'))
    .map(r => r.childNodes[0].textContent);
  check('ignored entries are listed', named(ignoreBox).length === 2, named(ignoreBox).join(','));
  check('the list has a header row',
    !!descend(doc.getElementById('abbrev-settings-ignore-box')).find(e => e.tagName === 'th'));

  const removeBtn = descend(ignoreBox).find(e => e.tagName === 'button');
  removeBtn.click();
  await tick(); await tick();
  check('the remove button un-ignores an entry', H._ignoreList().length === 1,
    H._ignoreList().join(','));

  // ---------- 6b. abbreviations are editable in the pane ----------
  // The point of the pane: no hand-editing JSON to add a meaning.
  const abbrEl = doc.getElementById('abbrev-settings-def-abbr');
  const termEl = doc.getElementById('abbrev-settings-def-term');
  const addBtn = doc.getElementById('abbrev-settings-def-add');
  check('the add-a-definition controls exist', !!(abbrEl && termEl && addBtn));

  abbrEl.value = 'ZZT';
  termEl.value = 'zinc zap tool';
  addBtn.click();
  await tick(); await tick();
  check('adding a definition saves it', H._userDefinitions().ZZT === 'zinc zap tool',
    JSON.stringify(H._userDefinitions()));
  check('the input is cleared afterwards', abbrEl.value === '' && termEl.value === '');

  // It must actually change detection, not just sit in a file.
  const seen = new Map(H._detectAbbreviations(
    'We used the widget (ZZT) throughout. ZZT again.').map(p => [p.abbr, p.term]));
  check('a pane-added definition overrides the paper', seen.get('ZZT') === 'zinc zap tool',
    seen.get('ZZT'));

  const defBox = doc.getElementById('abbrev-settings-def-list');
  const defRows = defBox.childNodes.filter(r =>
    r.tagName === 'tr' && !r.classList.contains('abbrev-settings-empty'));
  check('it appears in the list', defRows.some(r => r.childNodes[0].textContent === 'ZZT'));
  check('the meaning is shown next to it',
    defRows.some(r => r.childNodes[1].textContent === 'zinc zap tool'));
  check('the list scrolls rather than growing without limit',
    /max-height/.test(fs.readFileSync(SRC_DIR + '/settings.css', 'utf8')));

  const defRemove = descend(defBox).find(e => e.tagName === 'button');
  defRemove.click();
  await tick(); await tick();
  check('removing a definition works',
    Object.keys(H._userDefinitions()).length === 0, JSON.stringify(H._userDefinitions()));

  // Incomplete input is refused rather than written as a half entry.
  abbrEl.value = 'XX';
  termEl.value = '';
  addBtn.click();
  await tick();
  check('a definition with no meaning is refused',
    Object.keys(H._userDefinitions()).length === 0);
  check('and the reason is shown',
    /both/i.test(doc.getElementById('abbrev-settings-def-error').textContent || ''),
    doc.getElementById('abbrev-settings-def-error').textContent);

  // ---------- 6c. ignoring from the pane ----------
  const ignInput = doc.getElementById('abbrev-settings-ignore-input');
  const ignAdd = doc.getElementById('abbrev-settings-ignore-add');
  ignInput.value = 'NEB';
  ignAdd.click();
  await tick(); await tick();
  check('ignoring from the pane works', H._ignoreList().indexOf('NEB') !== -1,
    H._ignoreList().join(','));
  check('the ignore input is cleared', ignInput.value === '');
  ignInput.value = 'NEB';
  ignAdd.click();
  await tick(); await tick();
  check('ignoring the same entry twice does not duplicate it',
    H._ignoreList().filter(x => x === 'NEB').length === 1, H._ignoreList().join(','));

  // ---------- 7. every button is wired ----------
  const buttonIds = [...XHTML.matchAll(/<html:button id="([^"]+)"/g)].map(m => m[1]);
  check('markup declares buttons', buttonIds.length >= 4, buttonIds.join(','));
  const unwired = buttonIds.filter(id => {
    const el = doc.getElementById(id);
    return !el || !(el._listeners.click && el._listeners.click.length);
  });
  check('every button in the markup has a handler', unwired.length === 0,
    unwired.join(',') || 'all wired');

  // ---------- 8. registration is guarded ----------
  // Zotero 7 has PreferencePanes; if a build ever lacks it the plugin must
  // still load, falling back to the Tools menu.
  check('registration survives a missing API', H.registerPreferencePane() === null);
  Z.PreferencePanes = { register: (o) => { Z._registered = o; return 'pane-1'; }, unregister: () => { Z._unregistered = true; } };
  check('registration returns an id when available', H.registerPreferencePane() === 'pane-1');
  check('registered with the plugin id', Z._registered.pluginID === 'abbreviation-helper@cydoimos.github.io');
  check('registered src/scripts/stylesheets',
    Z._registered.src === 'settings.xhtml'
    && Z._registered.scripts.join() === 'settings.js'
    && Z._registered.stylesheets.join() === 'settings.css');
  H.unregisterPreferencePane();
  check('unregistered on shutdown', Z._unregistered === true);

  // ---------- 9. the files the pane needs are packaged ----------
  const packaged = fs.readFileSync(__dirname + '/../build.sh', 'utf8');
  for (const f of ['settings.xhtml', 'settings.js', 'settings.css', 'prefs.js']) {
    check(f + ' is included in the build', packaged.indexOf(f) !== -1);
  }

  // ---------- 10. prefs.js is Zotero's default-preferences file ----------
  // Naming the pane script prefs.js put it where Zotero expects pref() calls
  // and left every control in the 1.5.0 pane dead. Guard the name and the
  // contract: defaults must exist, and must agree with the code.
  const defaults = fs.readFileSync(SRC_DIR + '/prefs.js', 'utf8');
  check('prefs.js contains only pref() calls and comments',
    defaults.split('\n')
      .map(l => l.trim())
      .filter(l => l && l.indexOf('//') !== 0)
      .every(l => /^pref\("[^"]+",\s*.+\);$/.test(l)),
    defaults.split('\n').map(l => l.trim())
      .filter(l => l && l.indexOf('//') !== 0 && !/^pref\("[^"]+",\s*.+\);$/.test(l))
      .join(' | ') || 'all lines are pref() calls');

  check('the pane script is not named prefs.js',
    !fs.existsSync(SRC_DIR + '/settings.js') === false
    && !/scripts:\s*\['prefs\.js'\]/.test(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8')));

  const declared = new Map([...defaults.matchAll(/pref\("([^"]+)",\s*(.+)\);/g)]
    .map(m => [m[1], m[2].trim()]));
  check('every preference bound in the pane has a default',
    bound.every(p => declared.has(p)),
    bound.filter(p => !declared.has(p)).join(',') || 'all have defaults');

  // Defaults must match what the code falls back to, or the pane would show
  // one thing while the plugin does another.
  const codeDefaults = {
    hoverEnabled: 'true', tooltipModifier: '"none"',
    databaseLinksEnabled: 'true', databaseLinksModifier: '"shift"',
    databaseLinksOnAbbreviations: 'true',
    tooltipFontSize: '12', tooltipTheme: '"dark"'
  };
  const mismatched = Object.entries(codeDefaults)
    .filter(([k, v]) => declared.get(H.PREF_BRANCH + k) !== v)
    .map(([k, v]) => k + ' (' + declared.get(H.PREF_BRANCH + k) + ' vs ' + v + ')');
  check('defaults agree with the values in abbreviation.js',
    mismatched.length === 0, mismatched.join(', ') || 'all agree');

  // ---------- 11. the pane starts without relying on onload ----------
  const paneScript = fs.readFileSync(SRC_DIR + '/settings.js', 'utf8');
  check('the script self-starts rather than trusting the onload attribute',
    /setInterval\(/.test(paneScript) && /AbbrevSettings\.init\(\)/.test(paneScript));
  check('init is idempotent so onload and self-start cannot collide',
    /_initialised/.test(paneScript));

  console.log('');
  console.log(pass ? 'ALL PREFERENCE PANE TESTS PASSED' : 'SOME PREFERENCE PANE TESTS FAILED');
  process.exit(pass ? 0 : 1);
})();
