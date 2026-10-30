'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Regression tests for the fixes made after the code audit (tab selection,
 * the abbreviations file, the background scan, hover and tooltips). Each
 * section names the audit finding it guards. Zotero, the reader and the file
 * system are faked; the abbreviation detector itself is the real one. */
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const CODE = fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8');
const USER = '/zotero/abbreviation-helper/abbreviations.json';

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const tick = () => new Promise(r => setTimeout(r, 0));

function pdf(id, title) {
  return { id, title, isAttachment: () => true, attachmentMIMEType: 'application/pdf', getFilePath: () => '/' + title + '.pdf' };
}

/* A fake Zotero with one main window, reader tabs, a library selection, a PDF
 * worker that counts its calls, a notifier and an in-memory file system. */
function makeEnv(opts) {
  opts = opts || {};
  const FS = Object.assign({}, opts.files || {});
  const writes = [];
  const io = {
    async exists(p) { return Object.prototype.hasOwnProperty.call(FS, p); },
    async makeDirectory() {},
    async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT ' + p); return FS[p]; },
    async writeUTF8(p, s, o) { writes.push({ p, o }); FS[p] = s; }
  };
  const items = new Map();
  const texts = opts.texts || {};
  const worker = { calls: 0, pending: null, fail: false,
    async getFullText(id) {
      worker.calls++;
      if (worker.pending) await worker.pending;
      if (worker.fail) throw new Error('file missing');
      return { text: texts[id] || '' };
    } };
  const tabs = { selectedType: 'library', selectedID: 'zotero-pane' };
  const readers = {};
  const mainWindow = { Zotero_Tabs: tabs, ZoteroPane: {} };
  const notifier = { observers: {}, next: 1,
    registerObserver(ref, types) { const id = 'obs' + this.next++; this.observers[id] = { ref, types }; return id; },
    unregisterObserver(id) { delete this.observers[id]; } };
  let selection = [];
  const Zotero = {
    debug() {}, alert() {}, logError() {},
    DataDirectory: { dir: '/zotero' },
    Prefs: { get() { return undefined; }, set() {} },
    File: { reveal: async () => {} }, launchFile() {},
    getMainWindow: () => mainWindow, getMainWindows: () => [mainWindow],
    getActiveZoteroPane: () => ({ getSelectedItems: () => selection }),
    Items: { getAsync: async (id) => items.get(id) || null },
    Reader: { getByTabID: (id) => readers[id] || null },
    PDFWorker: worker, Notifier: notifier
  };
  const sb = { globalThis: {}, console, IOUtils: io, Zotero,
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => bundled }) };
  vm.createContext(sb);
  vm.runInContext(CODE + '\n;this.__H=AbbreviationHelper;', sb);
  const H = sb.__H;
  return {
    H, FS, writes, worker, tabs, notifier,
    addItem(it) { items.set(it.id, it); return it; },
    openTab(tabID, item) { readers[tabID] = { tabID, itemID: item.id }; tabs.selectedType = 'reader'; tabs.selectedID = tabID; },
    showLibrary() { tabs.selectedType = 'library'; tabs.selectedID = 'zotero-pane'; },
    select(...its) { selection = its; }
  };
}

async function started(env) {
  env.H.init({ id: 'abbreviation-helper@cydoimos.github.io', version: 'test', rootURI: 'r://' });
  await env.H._dictionariesReady;
  return env.H;
}

/* A minimal reader page: enough DOM for the tooltip code. */
function makeDoc() {
  const store = {};
  let created = 0;
  const win = { innerWidth: 1200, innerHeight: 800, listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); } };
  const mk = (tag) => {
    created++;
    const el = { tagName: tag, style: {}, dataset: {}, childNodes: [], textContent: '', id: '', parentNode: null,
      appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.textContent) this.textContent += c.textContent; if (c.id) store[c.id] = c; return c; },
      removeChild(c) {
        this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null;
        this.textContent = this.childNodes.map(x => x.textContent || '').join('');
        if (c.id && store[c.id] === c) delete store[c.id];
        return c;
      },
      addEventListener() {}, removeEventListener() {}, setAttribute(k, v) { this[k] = v; },
      contains(t) { return t === this || this.childNodes.some(c => c === t || (c.contains && c.contains(t))); },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 }),
      get firstChild() { return this.childNodes[0] || null; } };
    return el;
  };
  const listeners = {};
  const doc = {
    defaultView: win, store,
    get created() { return created; },
    body: null,
    createElement: mk,
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: (id) => store[id] || null,
    querySelector: () => ({}),
    querySelectorAll: () => [],
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    listeners
  };
  doc.body = mk('body');
  created = 0;
  return doc;
}
const tipOf = (doc) => doc.getElementById('abbreviation-helper-tooltip');
const visible = (doc) => !!tipOf(doc) && tipOf(doc).style.display !== 'none';

(async () => {
  const PAPER_A = 'The green fluorescent protein (GFP) was imaged. GFP was bright.';
  const PAPER_B = 'Reactive oxygen species (ROS) rose. ROS damaged cells.';

  // ---------- B1: the active reader tab, not the library selection ----------
  {
    const env = makeEnv({ texts: { 1: PAPER_A, 2: PAPER_B } });
    const H = await started(env);
    const a = env.addItem(pdf(1, 'a')), b = env.addItem(pdf(2, 'b'));
    env.select(a);
    env.openTab('tab-b', b);
    const found = await H._getCurrentAttachment();
    check('B1 the PDF in the active tab is used, not the library selection', found && found.item.id === 2,
      found ? 'item ' + found.item.id : 'none');
    env.showLibrary();
    check('B1 the background scan ignores the library', (await H._getCurrentAttachment({ readerOnly: true })) === null);
    const menu = await H._getCurrentAttachment();
    check('B1 the Scan menu still falls back to the selected item', menu && menu.item.id === 1);
  }

  // ---------- P1 / B8: background scan ----------
  {
    const env = makeEnv({ texts: { 1: PAPER_A, 3: 'Plain prose with no short forms at all.' } });
    const H = await started(env);
    let installs = 0;
    H._installHoverForAllWindows = () => { installs++; };
    env.select(env.addItem(pdf(1, 'a')));
    await H._autoScanActiveReader();
    check('P1 browsing the library does not start a scan', env.worker.calls === 0, 'calls=' + env.worker.calls);

    env.openTab('tab-c', env.addItem(pdf(3, 'empty')));
    for (let i = 0; i < 4; i++) await H._autoScanActiveReader();
    check('B8 a paper with no abbreviations is read once', env.worker.calls === 1, 'calls=' + env.worker.calls);
    check('B8 later ticks only top up listeners, they do not rescan', H.activeHoverItemID === 3);
    let removed = 0;
    const origRemove = H._removeHoverListeners.bind(H);
    H._removeHoverListeners = () => { removed++; origRemove(); };
    await H._autoScanActiveReader();
    check('B8 listeners are not torn down on each tick', removed === 0);
  }

  // ---------- tab changes are picked up at once ----------
  {
    const env = makeEnv({ texts: { 1: PAPER_A, 2: PAPER_B } });
    const H = await started(env);
    H._installHoverForAllWindows = () => {};
    H._startAutoScanTimer();
    const ids = Object.keys(env.notifier.observers);
    check('P6 a tab observer is registered', ids.length === 1 && env.notifier.observers[ids[0]].types[0] === 'tab');
    env.openTab('tab-a', env.addItem(pdf(1, 'a')));
    env.notifier.observers[ids[0]].ref.notify('select', 'tab', ['tab-a']);
    await new Promise(r => setTimeout(r, 200));
    check('P6 selecting a reader tab scans its paper', H.activeHoverItemID === 1 && H.activeHoverMap.has('GFP'));
    env.openTab('tab-b', env.addItem(pdf(2, 'b')));
    env.notifier.observers[ids[0]].ref.notify('select', 'tab', ['tab-b']);
    await new Promise(r => setTimeout(r, 200));
    check('P6 switching tabs swaps the meanings', H.activeHoverMap.has('ROS') && !H.activeHoverMap.has('GFP'));
    H._stopAutoScanTimer();
    check('P6 the observer is removed when scanning stops', Object.keys(env.notifier.observers).length === 0);
  }

  // ---------- extraction ----------
  {
    const env = makeEnv({ texts: { 4: '' } });
    const H = await started(env);
    H._installHoverForAllWindows = () => {};
    env.openTab('tab-d', env.addItem(pdf(4, 'scan')));
    await H._autoScanActiveReader();
    await H._autoScanActiveReader();
    check('D1 a PDF without a text layer is read once and gives no pairs',
      env.worker.calls === 1 && H.activeHoverItemID === 4 && H.activeHoverMap.size === 0);

    const env2 = makeEnv({ texts: { 5: PAPER_A } });
    const H2 = await started(env2);
    H2._installHoverForAllWindows = () => {};
    env2.worker.fail = true;
    env2.openTab('tab-e', env2.addItem(pdf(5, 'missing')));
    await H2._autoScanActiveReader();
    await H2._autoScanActiveReader();
    check('a PDF that fails is not retried on every tick', env2.worker.calls === 1, 'calls=' + env2.worker.calls);
    check('page breaks become spaces', (await (async () => {
      const e3 = makeEnv({ texts: { 6: 'one\ftwo' } }); const H3 = await started(e3);
      return H3._extractTextForItem({ id: 6 });
    })()) === 'one two');
  }

  // ---------- P3: settings edits do not re-read the PDF ----------
  {
    const env = makeEnv({ texts: { 1: PAPER_A } });
    const H = await started(env);
    H._installHoverForAllWindows = () => {};
    env.openTab('tab-a', env.addItem(pdf(1, 'a')));
    await H._autoScanActiveReader();
    await H._setUserDefinition('GFP', 'my own meaning');
    check('P3 adding a definition does not extract the PDF again', env.worker.calls === 1, 'calls=' + env.worker.calls);
    check('P3 the open paper uses the new definition', H.activeHoverMap.get('GFP') === 'my own meaning');
  }

  // ---------- B2: a file that cannot be read is never overwritten ----------
  {
    const broken = '{\n  // my notes\n  "userDefs": { "MSA": "Mannitol Salt agar" },\n  "ignore": ["NEB"]\n}';
    const env = makeEnv({ files: { [USER]: broken } });
    const H = await started(env);
    check('B2 the problem is recorded', /not valid JSON/.test(H.userFileError || ''), H.userFileError);
    let rejected = false;
    try { await H._setUserDefinition('PCR', 'polymerase chain reaction'); } catch (e) { rejected = true; }
    check('B2 an edit is refused', rejected);
    check('B2 the file is left exactly as it was', env.FS[USER] === broken);
    let rejected2 = false;
    try { await H._ignoreAbbreviation('XYZ'); } catch (e) { rejected2 = true; }
    check('B2 ignoring is refused too, file unchanged', rejected2 && env.FS[USER] === broken);
    check('B2 the message explains what to do', /could not be read/.test(H._saveFailedMessage()));

    env.FS[USER] = JSON.stringify({ userDefs: { MSA: 'Mannitol Salt agar' }, ignore: ['NEB'] });
    await H._reloadDictionaries(null);
    check('B2 once fixed and reloaded, the error clears', H.userFileError === null);
    check('B2 and the entries are in use', H._userDefinitions().MSA === 'Mannitol Salt agar');
  }
  {
    const env = makeEnv({ files: { [USER]: '   \n' } });
    const H = await started(env);
    await H._setUserDefinition('LB', 'lysogeny broth');
    check('B2 an empty file is simply filled in', JSON.parse(env.FS[USER]).userDefs.LB === 'lysogeny broth');
  }
  {
    const keep = { _comment: 'mine', userDefs: { A1: 'x' }, ignore: ['NEB'], databases: [{ label: 'D', url: 'https://e/?q={q}' }], extra: 42 };
    const env = makeEnv({ files: { [USER]: JSON.stringify(keep) } });
    const H = await started(env);
    await H._setUserDefinition('LB', 'lysogeny broth');
    const after = JSON.parse(env.FS[USER]);
    check('B2 an edit keeps everything else in the file',
      after._comment === 'mine' && after.userDefs.A1 === 'x' && after.ignore[0] === 'NEB'
      && after.databases.length === 1 && after.extra === 42 && after.userDefs.LB === 'lysogeny broth');
    check('D5 the file is written through a temporary file',
      env.writes.some(w => w.p === USER && w.o && w.o.tmpPath === USER + '.tmp'));
  }

  // ---------- B11: quick successive edits ----------
  {
    const env = makeEnv({});
    const H = await started(env);
    await Promise.all([H._setUserDefinition('AAA', 'first'), H._setUserDefinition('BBB', 'second'),
      H._ignoreAbbreviation('NEB')]);
    const f = JSON.parse(env.FS[USER]);
    check('B11 back-to-back edits all survive', f.userDefs.AAA === 'first' && f.userDefs.BBB === 'second'
      && f.ignore.indexOf('NEB') !== -1, JSON.stringify(f.userDefs));
    await Promise.all([H._removeUserDefinition('AAA'), H._removeUserDefinition('BBB')]);
    check('B11 back-to-back removals both apply', Object.keys(JSON.parse(env.FS[USER]).userDefs).length === 0);
  }

  // ---------- B12: lookup variants never replace another entry ----------
  {
    const env = makeEnv({});
    const H = await started(env);
    const m = H._buildHoverMap([{ abbr: 'A\u03b2', term: 'amyloid beta' }, { abbr: 'Ab', term: 'antibody' }]);
    check('B12 the paper\'s own "Ab" is kept', m.get('Ab') === 'antibody');
    check('B12 "A\u03b2" still resolves', m.get('A\u03b2') === 'amyloid beta');
    const p = H._buildHoverMap([{ abbr: 'EV', term: 'extracellular vesicle' }]);
    check('B12 plural variants still work', p.get('EVs') === 'extracellular vesicle');
  }

  // ---------- B13: nothing happens after shutdown ----------
  {
    const env = makeEnv({ texts: { 1: PAPER_A } });
    const H = await started(env);
    let release;
    env.worker.pending = new Promise(r => { release = r; });
    let installed = false;
    H._installHoverInWindow = () => { installed = true; };
    env.openTab('tab-a', env.addItem(pdf(1, 'a')));
    const scan = H._autoScanActiveReader();
    await tick();
    H.stop();
    release();
    await scan;
    check('B13 a scan finishing after shutdown attaches nothing', !installed && H.activeHoverItemID !== 1);
  }

  // ---------- hover: tooltips, stale state, speed ----------
  {
    const env = makeEnv({});
    const H = await started(env);
    const doc = makeDoc();
    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'green fluorescent protein' }]);
    H.databaseLinksEnabled = false;
    let word = 'GFP';
    H._wordAtPoint = () => word;
    const move = (x, y, target) => H._onReaderMouseMove(doc, { clientX: x, clientY: y, target: target || null });

    move(100, 100);
    check('hover shows the meaning', visible(doc) && /green fluorescent/.test(tipOf(doc).textContent));
    check('B9 a plain tooltip lets the mouse pass through', tipOf(doc).style.pointerEvents === 'none');
    const made = doc.created;
    move(103, 101);
    check('P4 moving within the same word does not rebuild the tooltip', doc.created === made,
      (doc.created - made) + ' elements made');
    check('P4 but the tooltip still follows the pointer', tipOf(doc).style.left === '117px');

    H._forgetHover(doc); // what scrolling does
    H._onReaderKeyDown(doc, { key: 'Shift', shiftKey: true });
    check('B10 after scrolling, pressing Shift does not bring the old tooltip back', !visible(doc));
    H._onReaderKeyUp(doc, { key: 'Shift' });

    move(100, 100);
    H._onReaderMouseLeave(doc, { relatedTarget: {} });
    check('moving onto another element keeps the tooltip', visible(doc));
    H._onReaderMouseLeave(doc, { relatedTarget: null });
    check('leaving the page hides it and forgets the word', !visible(doc) && H.lastHoverState === null);
    check('"Ignore an Abbreviation…" still suggests the last word explained', H.lastHoveredToken === 'GFP');

    move(100, 100);
    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'changed meaning' }]);
    H._refreshHoverFromLastState(doc);
    check('a redraw uses the current meanings, not stale ones', /changed meaning/.test(tipOf(doc).textContent));
  }
  {
    const env = makeEnv({});
    const H = await started(env);
    H.dictionaries = Object.assign({}, H.dictionaries, { databases: bundled.databases });
    const doc = makeDoc();
    H._setActiveHoverPairs(1, [{ abbr: 'EGFR', term: 'epidermal growth factor receptor' }]);
    H.databaseLinksModifier = 'none';
    let word = 'EGFR';
    H._wordAtPoint = () => word;
    H._onReaderMouseMove(doc, { clientX: 100, clientY: 100, target: null });
    const tip = tipOf(doc);
    check('B9 a tooltip with links can be clicked', tip && tip.style.pointerEvents === 'auto');
    const shown = tip.textContent;
    word = 'OTHER';
    H._onReaderMouseMove(doc, { clientX: 140, clientY: 130, target: tip.childNodes[0] });
    check('B9 the pointer over the tooltip keeps it open and unchanged', visible(doc) && tipOf(doc).textContent === shown);
    H._onReaderMouseMove(doc, { clientX: 108, clientY: 110, target: null });
    check('B9 on the way to the tooltip it holds still', visible(doc) && tipOf(doc).textContent === shown);
    await new Promise(r => setTimeout(r, H.CORRIDOR_MS + 50));
    check('B9 but not for ever: it then follows the word under the pointer', !visible(doc) || !/EGFR/.test(tipOf(doc).textContent));
    H.stop();
  }
  {
    // A tooltip left in a reader page by an earlier version is replaced.
    const env = makeEnv({});
    const H = await started(env);
    const doc = makeDoc();
    const old = doc.createElement('div');
    old.id = 'abbreviation-helper-tooltip';
    doc.body.appendChild(old);
    H._showHoverTooltip(doc, 10, 10, 'PCR', 'polymerase chain reaction', {});
    check('upgrade: an old version\'s tooltip is replaced, not reused',
      tipOf(doc) !== old && old.parentNode === null && tipOf(doc).dataset.abbreviationHelperOwner === H._instanceToken);
  }
  {
    // Listener bookkeeping.
    const env = makeEnv({});
    const H = await started(env);
    const doc = makeDoc();
    H._getReaderDocuments = () => [doc];
    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'green fluorescent protein' }]);
    H._installHoverForAllWindows();
    H._installHoverForAllWindows();
    check('listeners are attached once per page', H.hoverDocs.length === 1 && doc.listeners.mousemove.length === 1);
    check('P7 key-up is listened for once', !(doc.listeners.keyup || []).length && doc.defaultView.listeners.keyup.length === 1);
    H._showHoverTooltip(doc, 10, 10, 'GFP', 'green fluorescent protein', {});
    H._removeHoverListeners();
    check('P7 removing listeners also removes the tooltip', !tipOf(doc) && !doc.listeners.mousemove.length
      && !doc.defaultView.listeners.keyup.length);
  }

  console.log('\n' + (pass ? 'ALL FIX REGRESSION TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
