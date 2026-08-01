'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Tests for the Tools menu itself: structure, wording, the greying out of
 * database controls, and the popupshowing rebuilds that keep the menu honest
 * when state changes behind its back.
 *
 * The menu is built against a fake XUL document, so this covers the layout
 * without needing Zotero. */
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));

/* ---- minimal XUL-ish DOM ------------------------------------------------ */
function makeEl(tag, doc) {
  return {
    tagName: tag, id: '', parentNode: null, childNodes: [],
    _attrs: {}, _listeners: {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.id) doc._store[c.id] = c; return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    /* Test-only: invoke the handlers Zotero would invoke. */
    fire(t, ev) { for (const fn of (this._listeners[t] || []).slice()) fn(ev || { target: this }); },
    /* XUL toggles a checkbox or radio menuitem's `checked` attribute ITSELF,
     * before the command event fires — so a handler that reads the attribute
     * sees the new value, not the old one. Replicating that here is the whole
     * point: a mock that only fires `command` is easier to satisfy than the
     * real toolkit, and hid a bug where unchecking a database silently undid
     * itself. */
    click() {
      const type = this.getAttribute('type');
      if (type === 'checkbox') {
        this.setAttribute('checked', this.getAttribute('checked') === 'true' ? 'false' : 'true');
      } else if (type === 'radio') {
        this.setAttribute('checked', 'true');
      }
      this.fire('command');
    },
    get firstChild() { return this.childNodes[0] || null; },
    get label() { return this._attrs.label; }
  };
}

function makeDoc() {
  const doc = { _store: {} };
  doc.createXULElement = (t) => makeEl(t, doc);
  doc.createElement = doc.createXULElement;
  doc.getElementById = (id) => doc._store[id] || null;
  const tools = makeEl('menupopup', doc);
  tools.id = 'menu_ToolsPopup';
  doc._store.menu_ToolsPopup = tools;
  return doc;
}

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

/* ---- tree helpers ------------------------------------------------------- */
const walk = (el, out = []) => { out.push(el); for (const c of el.childNodes) walk(c, out); return out; };
const labels = (el) => walk(el).map(e => e.getAttribute('label')).filter(Boolean);
const findByLabel = (el, label) => walk(el).find(e => e.getAttribute('label') === label) || null;
/* A submenu's items live in the menupopup child of the <menu>. */
const popupOf = (menuEl) => menuEl && menuEl.childNodes.find(c => c.tagName === 'menupopup');

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };

(async () => {
  const env = makeEnv({});
  const H = env.H;
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;

  const doc = makeDoc();
  const window = { document: doc };
  H.addToWindow(window);

  const root = doc.getElementById('abbreviation-helper-menu');
  check('menu is created', !!root);
  check('menu is attached to the Tools menu',
    !!root && doc._store.menu_ToolsPopup.childNodes.indexOf(root) !== -1);

  const rootPopup = popupOf(root);
  const top = rootPopup.childNodes;
  const topItems = top.filter(c => c.tagName !== 'menuseparator');

  // ---------- 1. the top level stays short ----------
  // The whole point of the rework: rarely used settings live in submenus.
  check('top level is short', topItems.length <= 12, topItems.length + ' items');
  check('calling addToWindow twice does not duplicate the menu',
    (H.addToWindow(window), doc._store.menu_ToolsPopup.childNodes.filter(c => c.id === 'abbreviation-helper-menu').length === 1));

  // ---------- 2. no disabled pseudo-headers at the top level ----------
  // Bold disabled rows read as broken features; separators do the grouping.
  const topDisabled = topItems.filter(c => c.getAttribute('disabled') === 'true');
  check('no greyed-out header rows at the top level', topDisabled.length === 0,
    topDisabled.map(c => c.label).join(','));
  check('top level is grouped by separators',
    top.filter(c => c.tagName === 'menuseparator').length >= 3);

  // ---------- 3. one name for the settings file ----------
  const all = labels(root).join(' | ');
  check('no "config file" anywhere', !/config file/i.test(all));
  check('no "custom dictionary" anywhere', !/custom dictionary/i.test(all));

  // The same vocabulary has to hold in alerts and comments, not just menu
  // labels — a dialog that tells you to pick "Reload custom dictionary" is
  // naming a menu item that no longer exists.
  for (const f of ['abbreviation.js', 'settings.js', 'settings.xhtml']) {
    const src = require('fs').readFileSync(SRC_DIR + '/' + f, 'utf8');
    check(f + ' says nothing about a "custom dictionary"', !/custom dictionary/i.test(src));
    check(f + ' says nothing about a "config file"', !/config file/i.test(src));
  }
  // Two here; the third ("Edit in Abbreviations File…") lives in the Databases
  // submenu, which is not built until it is opened — checked separately below.
  check('the file is always the "abbreviations file"',
    (all.match(/[Aa]bbreviations [Ff]ile/g) || []).length >= 2, all.match(/[Aa]bbreviations [Ff]ile/g) + '');

  // ---------- 3b. the default menu is actions only ----------
  // Settings live in the Settings window; the menu holds what you *do*.
  check('Settings… is offered', !!findByLabel(root, 'Settings…'));
  check('Scan is offered', !!findByLabel(root, 'Scan This PDF and Copy List'));
  check('Ignore an Abbreviation is offered', !!findByLabel(root, 'Ignore an Abbreviation…'));
  check('the file actions are offered',
    !!findByLabel(root, 'Open Abbreviations File…') && !!findByLabel(root, 'Reload Abbreviations File'));

  check('no hover switch by default', !findByLabel(root, 'Show meanings on hover'));
  check('no database switch by default', !findByLabel(root, 'Show database links'));
  check('no modifier submenu by default', !findByLabel(root, 'When to Show…'));
  check('no Databases submenu by default', !findByLabel(root, 'Databases'));
  check('no appearance submenu by default', !findByLabel(root, 'Tooltip Appearance'));
  check('the simple menu is genuinely short',
    rootPopup.childNodes.filter(c => c.tagName !== 'menuseparator').length <= 6,
    rootPopup.childNodes.filter(c => c.tagName !== 'menuseparator').length + ' items');

  // ---------- 3c. the advanced toggle brings the settings back ----------
  // Rebuilt on open, so the preference takes effect without a restart.
  H._setPref('advancedMenu', true);
  rootPopup.fire('popupshowing', { target: rootPopup });
  check('the advanced menu is applied without restarting', H.advancedMenu === true);

  const topNow = rootPopup.childNodes;
  const topItemsNow = topNow.filter(c => c.tagName !== 'menuseparator');
  check('advanced still keeps the actions', !!findByLabel(root, 'Scan This PDF and Copy List'));
  check('advanced top level stays manageable', topItemsNow.length <= 12, topItemsNow.length + ' items');

  // ---------- 4. the two switches are top level ----------
  check('"Show meanings on hover" is top level', topNow.indexOf(findByLabel(root, 'Show meanings on hover')) !== -1);
  check('"Show database links" is top level', topNow.indexOf(findByLabel(root, 'Show database links')) !== -1);

  // ---------- 5. modifier settings are together, phrased as sentences ----------
  const when = popupOf(findByLabel(root, 'When to Show\u2026'));
  check('both modifier groups share one submenu', !!when);
  const whenRadios = when.childNodes.filter(c => c.getAttribute('type') === 'radio');
  check('both groups present', whenRadios.length === 8, whenRadios.length + ' radio items');
  check('two distinct radio group names',
    new Set(whenRadios.map(c => c.getAttribute('name'))).size === 2);
  check('the no-key choice reads "Always"',
    whenRadios.filter(c => c.label === 'Always').length === 2);

  // ---------- 6. master switch greys out its dependents ----------
  const dbSwitch = findByLabel(root, 'Show database links');
  const dbMenu = findByLabel(root, 'Databases');
  const onAbbr = findByLabel(root, 'Also show links on defined abbreviations');
  const dbRadios = whenRadios.filter(c => c.getAttribute('name') === 'abbrev-db-mod');
  check('dependents start enabled', dbMenu.getAttribute('disabled') === 'false');

  dbSwitch.click();
  check('switching off disables the Databases submenu', dbMenu.getAttribute('disabled') === 'true');
  check('switching off disables the database modifier choices',
    dbRadios.every(c => c.getAttribute('disabled') === 'true'));
  check('switching off disables the abbreviation-links checkbox',
    onAbbr.getAttribute('disabled') === 'true');
  check('and the behaviour matches the greying', H._lookupDatabaseLinks('EGFR') === null);

  dbSwitch.click();
  check('switching back on re-enables them', dbMenu.getAttribute('disabled') === 'false'
    && dbRadios.every(c => c.getAttribute('disabled') === 'false'));
  check('and links work again', !!H._lookupDatabaseLinks('EGFR'));

  // ---------- 7. the Databases submenu reflects the file, not startup ----------
  // Regression test: it used to be built once, so a database added to the
  // file and applied with Reload stayed invisible until Zotero restarted.
  const dbPopup = popupOf(dbMenu);
  dbPopup.fire('popupshowing');
  const firstPass = labels(dbPopup);
  check('databases are listed', firstPass.indexOf('UniProt') !== -1, firstPass.join(','));
  check('the submenu offers editing the file', firstPass.some(l => /Abbreviations File/.test(l)));

  H.dictionaries.databases = H.dictionaries.databases.concat(
    [{ group: 'Gene/protein databases', label: 'Ensembl', url: 'https://ensembl.org/?q={q}', enabled: true }]);
  dbPopup.fire('popupshowing');
  check('a database added after startup appears without a restart',
    labels(dbPopup).indexOf('Ensembl') !== -1);
  check('rebuilding does not duplicate entries',
    labels(dbPopup).filter(l => l === 'UniProt').length === 1);

  // ---------- 7b. clicking a database actually turns it off ----------
  // Driven through the menu item rather than _setDatabaseEnabled, because the
  // bug was in the handler: it read the `checked` attribute that XUL had
  // already flipped, so it computed the old value and wrote it back.
  const enabledNames = () => H._enabledDatabases().map(d => d.label);
  const uniprot = findByLabel(dbPopup, 'UniProt');
  check('UniProt starts enabled', enabledNames().indexOf('UniProt') !== -1);

  uniprot.click();
  check('clicking it disables it', enabledNames().indexOf('UniProt') === -1,
    enabledNames().join(','));
  check('and the checkbox shows unchecked', uniprot.getAttribute('checked') === 'false');
  check('it stays off when the menu is reopened',
    (dbPopup.fire('popupshowing'), findByLabel(dbPopup, 'UniProt').getAttribute('checked') === 'false'));

  findByLabel(dbPopup, 'UniProt').click();
  check('clicking again re-enables it', enabledNames().indexOf('UniProt') !== -1,
    enabledNames().join(','));

  // Other databases must be unaffected either way.
  check('disabling one leaves the rest alone',
    enabledNames().indexOf('HGNC') !== -1 && enabledNames().indexOf('PubChem') !== -1);

  // A database marked enabled:false in the file starts off, but the menu can
  // still switch it on — otherwise it would be a control that does nothing.
  H.dictionaries.databases = H.dictionaries.databases.concat(
    [{ group: 'Chemical/drug databases', label: 'ChEMBL', url: 'https://x/{q}', enabled: false }]);
  dbPopup.fire('popupshowing');
  check('a database disabled in the file starts unchecked',
    findByLabel(dbPopup, 'ChEMBL').getAttribute('checked') === 'false');
  findByLabel(dbPopup, 'ChEMBL').click();
  check('and can still be switched on from the menu',
    enabledNames().indexOf('ChEMBL') !== -1, enabledNames().join(','));

  // ---------- 7c. settings do not dismiss the menu ----------
  // XUL closes the whole menu on every command unless told otherwise, which
  // makes changing several settings needlessly tedious.
  const stays = (el) => el && el.getAttribute('closemenu') === 'none';
  const everyItem = walk(root).filter(e => e.tagName === 'menuitem');
  const settings = everyItem.filter(e => ['checkbox', 'radio'].indexOf(e.getAttribute('type')) !== -1);
  check('there are settings items to check', settings.length >= 20, settings.length + '');
  check('every checkbox and radio keeps the menu open', settings.every(stays),
    settings.filter(e => !stays(e)).map(e => e.label).join(',') || 'all keep it open');

  check('the hover switch keeps it open', stays(findByLabel(root, 'Show meanings on hover')));
  check('database checkboxes keep it open', stays(findByLabel(dbPopup, 'HGNC')));
  check('modifier choices keep it open', stays(whenRadios[0]));

  // Actions are the opposite: after asking for something to happen, the menu
  // closing is the expected acknowledgement.
  check('Scan closes the menu', !stays(findByLabel(root, 'Scan This PDF and Copy List')));
  check('Open Abbreviations File closes the menu',
    !stays(findByLabel(root, 'Open Abbreviations File…')));
  check('Ignore an Abbreviation closes the menu',
    !stays(findByLabel(root, 'Ignore an Abbreviation…')));

  // ---------- 8. the menu re-reads state when it opens ----------
  // Preferences are shared between windows, so what the menu drew at startup
  // can be out of date by the time it is opened.
  // Written as preferences, not properties: the menu re-reads preferences when
  // it opens, which is what makes a change in the Settings window show up here.
  H._setPref('hoverEnabled', false);
  H._setPref('databaseLinksEnabled', false);
  rootPopup.fire('popupshowing', { target: rootPopup });
  check('hover checkbox re-syncs on open',
    findByLabel(root, 'Show meanings on hover').getAttribute('checked') === 'false');
  check('database checkbox re-syncs on open',
    findByLabel(root, 'Show database links').getAttribute('checked') === 'false');
  check('dependents re-sync on open',
    findByLabel(root, 'Databases').getAttribute('disabled') === 'true');
  H._setPref('hoverEnabled', true);
  H._setPref('databaseLinksEnabled', true);
  rootPopup.fire('popupshowing', { target: rootPopup });

  // ---------- 9. the ignore list is visible at a glance ----------
  check('ignored submenu present', !!findByLabel(root, 'Ignored Abbreviations'));
  await H._updateUserConfig({ ignore: ['NEB', 'PTEN'] });
  await H._reloadDictionaries(null);
  rootPopup.fire('popupshowing', { target: rootPopup });
  // Re-queried after the rebuild: the earlier element is no longer in the tree.
  const ignored = walk(root).find(e => /^Ignored Abbreviations/.test(e.getAttribute('label') || ''));
  check('the count shows in the label', /\(2\)/.test(ignored.getAttribute('label')),
    ignored.getAttribute('label'));

  const ignoredPopup = popupOf(ignored);
  ignoredPopup.fire('popupshowing');
  check('entries are listed', labels(ignoredPopup).indexOf('NEB') !== -1);
  check('un-ignore entries keep the menu open', stays(findByLabel(ignoredPopup, 'NEB')));
  findByLabel(ignoredPopup, 'NEB').click();
  await new Promise(r => setTimeout(r, 0));
  check('clicking an entry stops ignoring it', H._ignoreList().indexOf('NEB') === -1,
    H._ignoreList().join(','));
  // Because the list stays open, it has to redraw rather than leave the row.
  check('the removed row disappears without reopening',
    labels(ignoredPopup).indexOf('NEB') === -1, labels(ignoredPopup).join(','));
  check('the remaining entry is still listed', labels(ignoredPopup).indexOf('PTEN') !== -1);

  await H._setIgnoreList([]);
  rootPopup.fire('popupshowing', { target: rootPopup });
  const ignoredNow = walk(root).find(e => /^Ignored Abbreviations/.test(e.getAttribute('label') || ''));
  check('an empty list shows no count',
    ignoredNow.getAttribute('label') === 'Ignored Abbreviations', ignoredNow.getAttribute('label'));
  const ignoredPopupNow = popupOf(ignoredNow);
  ignoredPopupNow.fire('popupshowing');
  check('and says so when opened', labels(ignoredPopupNow).indexOf('(none ignored)') !== -1);

  // ---------- 10. teardown removes what it added ----------
  H.removeFromWindow(window);
  check('menu is removed again',
    doc._store.menu_ToolsPopup.childNodes.filter(c => c.id === 'abbreviation-helper-menu').length === 0);

  console.log('');
  console.log(pass ? 'ALL MENU TESTS PASSED' : 'SOME MENU TESTS FAILED');
  process.exit(pass ? 0 : 1);
})();
