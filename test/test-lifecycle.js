'use strict';
/* The plugin's life as Zotero runs it: bootstrap.js starts it, the Tools menu
 * and the Settings pane appear, a disable or update shuts it down and leaves
 * nothing behind, and it can be started again (an update or re-enable). The
 * window, Services and Zotero are faked; bootstrap.js and abbreviation.js are
 * the real files. */
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* A XUL-ish document: elements register their ids while attached. */
function makeDocument() {
  const ids = new Map();
  const attach = (el, on) => {
    if (el.id) on ? ids.set(el.id, el) : ids.get(el.id) === el && ids.delete(el.id);
    for (const c of el.childNodes) attach(c, on);
  };
  const doc = {
    getElementById: id => ids.get(id) || null,
    createXULElement(tag) {
      const el = {
        tagName: tag, childNodes: [], parentNode: null, _attrs: {}, _listeners: {}, _id: '',
        get id() { return this._id; }, set id(v) { this._id = v; },
        setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (this._attached) { c._attached = true; attach(c, true); } return c; },
        removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); attach(c, false); c.parentNode = null; return c; },
        remove() { if (this.parentNode) this.parentNode.removeChild(this); },
        addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
        get firstChild() { return this.childNodes[0] || null; }
      };
      return el;
    }
  };
  const tools = doc.createXULElement('menupopup');
  tools.id = 'menu_ToolsPopup';
  tools._attached = true;
  ids.set(tools.id, tools);
  return { doc, tools };
}

function makeZotero() {
  const { doc, tools } = makeDocument();
  const window = { document: doc, ZoteroPane: {}, Zotero_Tabs: { selectedType: 'library' }, _keys: [],
    addEventListener(t, fn) { this._keys.push([t, fn]); },
    removeEventListener(t, fn) { this._keys = this._keys.filter(([u, g]) => !(u === t && g === fn)); } };
  const timers = new Set();
  const panes = { registered: null, unregistered: false };
  const observers = new Set();
  const Zotero = {
    debug() {}, alert() {}, DataDirectory: { dir: '/zotero' },
    Prefs: { get() {}, set() {} },
    getMainWindows: () => [window], getMainWindow: () => window,
    getActiveZoteroPane: () => ({ getSelectedItems: () => [] }),
    Promise: { delay: ms => wait(ms) },
    PreferencePanes: {
      register(o) { panes.registered = o; return 'pane-1'; },
      unregister() { panes.unregistered = true; }
    },
    Notifier: {
      registerObserver(o) { observers.add(o); return o; },
      unregisterObserver(o) { observers.delete(o); }
    }
  };
  const prefObservers = new Set();
  const listeners = new Set();
  const FS = {};
  const sandbox = {
    console, Zotero,
    IOUtils: {
      async exists(p) { return p in FS; }, async makeDirectory() {},
      async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT'); return FS[p]; },
      async writeUTF8(p, s) { FS[p] = s; }, async remove(p) { delete FS[p]; }
    },
    fetch: async () => ({ ok: true, json: async () => bundled }),
    // Timers are tracked, so the test can tell whether shutdown stops them.
    setTimeout(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; },
    clearTimeout(t) { timers.delete(t); clearTimeout(t); },
    setInterval(fn, ms) { const t = setInterval(fn, ms); timers.add(t); return t; },
    clearInterval(t) { timers.delete(t); clearInterval(t); },
    Services: {
      scriptloader: { loadSubScript(url) { vm.runInContext(fs.readFileSync(SRC_DIR + '/' + url.replace('r://', ''), 'utf8'), sandbox); } },
      wm: { addListener(l) { listeners.add(l); }, removeListener(l) { listeners.delete(l); } },
      prefs: { getBranch: () => ({ addObserver(_, o) { prefObservers.add(o); }, removeObserver(_, o) { prefObservers.delete(o); } }) }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/bootstrap.js', 'utf8'), sandbox);
  return { sandbox, Zotero, doc, tools, timers, panes, observers, prefObservers, listeners };
}

(async () => {
  const z = makeZotero();
  const params = { id: 'abbreviation-helper@cydoimos.github.io', version: 'test', rootURI: 'r://' };

  await z.sandbox.startup(params);
  await wait(30);
  check('startup adds the Tools menu', !!z.doc.getElementById('abbreviation-helper-menu'));
  check('startup registers the Settings pane', z.panes.registered && z.panes.registered.src === 'settings.xhtml');
  check('the Settings pane can reach the plugin', z.Zotero.AbbreviationHelper === z.sandbox.AbbreviationHelper);
  check('startup watches preferences and tabs (Zotero itself announces new windows)',
    z.prefObservers.size === 1 && z.observers.size === 1 && z.listeners.size === 0);
  check('the background scan is running', z.timers.size >= 1);

  // A main window loading later gets the menu once, however it is announced.
  z.sandbox.onMainWindowLoad({ window: { document: z.doc, ZoteroPane: {} } });
  check('a second announcement does not add a second menu',
    z.tools.childNodes.filter(c => c.id === 'abbreviation-helper-menu').length === 1);

  // The main window follows the modifier keys while a tooltip is on.
  const H = z.sandbox.AbbreviationHelper;
  H.usesEnabled = true;
  H._installHoverForAllWindows();
  const win = z.Zotero.getMainWindow();
  check('the main window follows the modifier keys', win._keys.length === 2, win._keys.length + '');

  z.sandbox.shutdown();
  await wait(10);
  check('shutdown stops following them', win._keys.length === 0, win._keys.length + ' left');
  check('shutdown removes the Tools menu', !z.doc.getElementById('abbreviation-helper-menu'));
  check('shutdown unregisters the Settings pane', z.panes.unregistered);
  check('shutdown stops every timer', z.timers.size === 0, z.timers.size + ' left');
  check('shutdown stops watching preferences and tabs',
    z.prefObservers.size === 0 && z.observers.size === 0 && z.listeners.size === 0);
  check('shutdown leaves nothing on the Zotero object', !('AbbreviationHelper' in z.Zotero));

  // An update or re-enable starts it again in the same scope.
  z.panes.unregistered = false;
  await z.sandbox.startup(params);
  await wait(30);
  check('it starts again after a shutdown', !!z.doc.getElementById('abbreviation-helper-menu')
    && z.Zotero.AbbreviationHelper === z.sandbox.AbbreviationHelper);
  z.sandbox.shutdown();
  await wait(10);
  check('and shuts down cleanly again', !z.doc.getElementById('abbreviation-helper-menu') && z.timers.size === 0);

  console.log('\n' + (pass ? 'ALL LIFECYCLE TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
