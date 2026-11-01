'use strict';
/* "Where a word is used": finding a word's uses in the text of a PDF, and
 * the tooltip that lists them while a modifier key is held, in a faked
 * reader. The finder and the plugin are the real code. */
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const wait = ms => new Promise(r => setTimeout(r, ms));

// Three pages, with a running header on each page that also says "EV".
const PAGES = [
  'EV Research Letters\nWe isolated extracellular vesicles (EVs) from plasma. The EV yield\nwas high.',
  'EV Research Letters\nNothing here mentions it in lower case: ev, EVOLVE, prEV. The binding was\nmeasured as a dissociation constant (KD). Each EV-derived signal was kept.',
  'EV Research Letters\nKD values agreed. ' + 'Many words come before the last use of the abbreviation in this long sentence so that the context has to be cut short at some point before it, KD, and after it there are also many words that go on and on without a full stop for a while longer.'
];
// As Zotero returns it: each page ends with blank lines, a form feed starts the next.
const TEXT = PAGES.join('\n\n\n\f');

function makeEnv(prefs) {
  const reader = { itemID: 5, calls: [], navigate(loc) { this.calls.push(loc); return Promise.resolve(); } };
  const window = { Zotero_Tabs: { selectedType: 'reader', selectedID: 't1' } };
  const sb = {
    globalThis: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => bundled }),
    IOUtils: { async exists() { return false; }, async makeDirectory() {}, async readUTF8() { throw new Error('none'); }, async writeUTF8() {} },
    Zotero: {
      debug() {}, alert() {}, DataDirectory: { dir: '/zotero' },
      Prefs: { get: k => (prefs || {})[k.replace('extensions.abbreviation-helper.', '')], set() {} },
      getMainWindow: () => window, getMainWindows: () => [window],
      Items: { getAsync: async id => ({ id }) },
      Reader: { getByTabID: () => reader },
      PDFWorker: { async getFullText() { return { text: TEXT }; } }
    }
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8') + '\n;this.__H=AbbreviationHelper;', sb);
  return { H: sb.__H, sb, reader };
}

/* Just enough DOM for a tooltip. */
function makeDoc() {
  const store = {};
  const mk = tag => ({
    tagName: tag, style: {}, dataset: {}, childNodes: [], id: '', parentNode: null, _click: null,
    get textContent() { return this._text !== undefined ? this._text : this.childNodes.map(c => c.textContent).join(''); },
    set textContent(t) { this._text = t; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.id) store[c.id] = c; return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; if (store[c.id] === c) delete store[c.id]; },
    addEventListener(t, fn) { if (t === 'click') this._click = fn; }, setAttribute(k, v) { this[k] = v; }, contains() { return false; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
    get firstChild() { return this.childNodes[0] || null; }
  });
  return {
    body: mk('body'), defaultView: { innerWidth: 1200, innerHeight: 800 },
    createElement: mk, createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    getElementById: id => store[id] || null
  };
}
const tip = doc => doc.getElementById('abbreviation-helper-tooltip');
const rows = doc => tip(doc).childNodes.map(c => c.textContent);
const key = (k, extra) => Object.assign({ key: k, code: 'Key' + k.toUpperCase(), target: {}, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, extra || {});

(async () => {
  const { sb } = makeEnv();

  // ---------- finding the uses ----------
  check('one text per page, page breaks kept', sb.pageTexts(TEXT).length === 3);
  check('running headers are not uses', !sb.pageTexts(TEXT).some(p => /Research Letters/.test(p)));
  const ev = sb.findUses(TEXT, 'EV', 10, 15);
  check('singular, plural and compounds count; case and longer words do not',
    ev.total === 3 && ev.uses.map(u => u.match).join(',') === 'EVs,EV,EV', ev.total + ' ' + ev.uses.map(u => u.match));
  check('each use knows its page and its place on it',
    ev.uses.map(u => u.pageIndex + ':' + u.nthOnPage).join(' ') === '0:0 0:1 1:0', ev.uses.map(u => u.pageIndex + ':' + u.nthOnPage).join(' '));
  const kd = sb.findUses(TEXT, 'KD', 2, 10);
  check('only the first uses are listed, and all are counted', kd.total === 3 && kd.uses.length === 2);
  check('the words around a use stop at its sentence',
    kd.uses[0].before === 'The binding was measured as a dissociation constant (' && kd.uses[0].after === ').',
    JSON.stringify(kd.uses[0]));
  const last = sb.findUses(TEXT, 'KD', 3, 8).uses[2];
  check('long context is cut, and says so', /^…/.test(last.before) && /…$/.test(last.after)
    && last.before.split(' ').length <= 9, JSON.stringify(last));
  check('a word that is not there has no uses', sb.findUses(TEXT, 'XYZ', 3, 15).total === 0);
  const opening = sb.findUses('It was blocked. EGFR levels fell.', 'EGFR', 3, 15).uses[0];
  check('a use that starts a sentence has nothing of the sentence before', opening.before === ''
    && opening.after === ' levels fell.', JSON.stringify(opening));

  // ---------- the held key in the reader ----------
  let env = makeEnv();
  let H = env.H;
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  check('off for a new install, like database links: only meanings are on', H.usesEnabled === false
    && H.databaseLinksEnabled === false && H.hoverEnabled === true);
  H.usesEnabled = true;
  H.textCache.set(5, TEXT);
  H._setActiveHoverPairs(5, [{ abbr: 'EV', term: 'extracellular vesicle', certainty: 'defined' }]);
  let doc = makeDoc();
  let word = 'KD';
  H._wordAtPoint = () => word;
  const hover = (x, mods) => H._onReaderMouseMove(doc, Object.assign({ clientX: x || 50, clientY: 50, target: null }, mods));
  const keyDown = (k, flags) => H._onReaderKeyDown(doc, Object.assign({ key: k }, flags));
  const keyUp = (k, flags) => H._onReaderKeyUp(doc, Object.assign({ key: k }, flags));
  const shown = () => !!tip(doc) && tip(doc).style.display === 'block';

  check('it is shown while holding Ctrl (or Cmd on a Mac)', H.usesModifier === 'ctrl');
  hover();
  check('no meaning, so pointing at KD shows nothing', !shown());
  keyDown('Control', { ctrlKey: true });
  check('holding Ctrl over KD lists where it is used', shown()
    && rows(doc)[0] === 'KD — where it is used' && rows(doc)[1] === 'Used 3 times:', rows(doc).slice(0, 2).join(' | '));
  const choice = i => tip(doc).childNodes[2].childNodes[i];
  check('each use is a numbered choice with its page and words, the word in bold',
    choice(0).textContent === '1p. 2 · The binding was measured as a dissociation constant (KD).'
    && choice(0).childNodes[0].textContent === '1' && choice(0).childNodes[3].tagName === 'strong', choice(0).textContent);
  check('and the tooltip says how to choose', rows(doc)[3] === 'Click one, or press its number.', rows(doc)[3]);
  check('the list can be clicked', tip(doc).style.pointerEvents === 'auto');
  keyUp('Control', { ctrlKey: false });
  await wait(150);     // the same short hide delay as the other tooltips
  check('letting go of the key hides it, as with the other tooltips: no toggle', !shown());

  H._isMac = () => false;
  hover(51, { metaKey: true });
  check('on Windows and Linux, the Windows or Super key is not Ctrl', !shown());
  H._isMac = () => true;
  hover(52, { metaKey: true });
  check('on a Mac, Cmd works for Ctrl', shown() && rows(doc)[0] === 'KD — where it is used');
  const t = tip(doc);
  t.contains = x => x === t;
  H._onReaderMouseMove(doc, { clientX: 70, clientY: 70, target: t, metaKey: true });
  keyUp('Meta', { metaKey: false });
  check('with the pointer on the list, letting go keeps it, so a use can still be chosen', shown());
  let e = key('2', { code: 'Digit2' });
  H._onReaderKeyDown(doc, e);
  await wait(5);
  check('a number goes to that use', e.defaultPrevented && env.reader.calls.length === 1
    && env.reader.calls[0].pageIndex === 2, JSON.stringify(env.reader.calls));
  check('and closes the list', !shown());

  hover(60, { ctrlKey: true });
  H._isMac = () => false;
  const others = ['altKey', 'metaKey'].map(m => { const k = key('1', { code: 'Digit1', [m]: true }); H._onReaderKeyDown(doc, k); return k; });
  check('with Alt, or the Windows key, which do not show the list, a number is left to Zotero (the reader\'s tools)',
    others.every(k => !k.defaultPrevented) && env.reader.calls.length === 1);
  const altGr = key('@', { code: 'Digit0', getModifierState: m => m === 'AltGraph' });
  H._onReaderKeyDown(doc, altGr);
  check('AltGr with a number key types a character ("@" on a French keyboard), so it is not a choice',
    !altGr.defaultPrevented);
  const composing = key('1', { code: 'Digit1', isComposing: true });
  H._onReaderKeyDown(doc, composing);
  check('a key that is part of composing a character is not a choice', !composing.defaultPrevented);
  const ctrl1 = key('1', { code: 'Digit1', ctrlKey: true });
  H._onReaderKeyDown(doc, ctrl1);
  await wait(5);
  check('with the key that shows the list still held, a number chooses, kept from Zotero\'s tab switching',
    ctrl1.defaultPrevented && env.reader.calls.length === 2 && env.reader.calls[1].pageIndex === 1, JSON.stringify(env.reader.calls));
  H._isMac = () => true;
  hover(62, { metaKey: true });
  const cmd2 = key('2', { code: 'Digit2', metaKey: true });
  H._onReaderKeyDown(doc, cmd2);
  await wait(5);
  check('on a Mac, Cmd and a number choose when Cmd shows the list', cmd2.defaultPrevented && env.reader.calls.length === 3);
  H.usesModifier = 'alt';
  hover(63, { altKey: true });
  // Option and the "1" key of a French Mac keyboard: it types a symbol, and
  // the system may report Option as AltGraph; the key's place is what counts.
  const option1 = key('\uf8ff', { code: 'Digit1', altKey: true, getModifierState: m => m === 'AltGraph' || m === 'Alt' });
  H._onReaderKeyDown(doc, option1);
  await wait(5);
  check('on a French Mac keyboard, Option and a number key choose when Option shows the list',
    option1.defaultPrevented && env.reader.calls.length === 4);
  H.usesModifier = 'ctrl';
  H._forgetHover(doc);
  hover(61);
  H._onReaderKeyDown(doc, { key: 'Control', ctrlKey: true, target: { tagName: 'TEXTAREA' } });
  check('a key pressed while typing in a text field brings no tooltip', !shown());
  H._onReaderKeyUp(doc, { key: 'Control', ctrlKey: false, target: { tagName: 'TEXTAREA' } });
  hover(60, { ctrlKey: true });
  tip(doc).childNodes[2].childNodes[0]._click({ preventDefault() {}, stopPropagation() {} });
  await wait(5);
  check('clicking a use goes there', env.reader.calls.length === 5 && env.reader.calls[4].pageIndex === 1);

  word = 'EVs';
  hover(70, { ctrlKey: true });
  check('over a word with a meaning, the uses come under it, set off by a line, and every form is found',
    rows(doc).slice(0, 4).join(' | ') === 'EVs — extracellular vesicle | Defined in this paper |  | EV: used 3 times:',
    rows(doc).slice(0, 4).join(' | '));
  hover(71);
  check('without the key, only the meaning', rows(doc).join(' | ') === 'EVs — extracellular vesicle | Defined in this paper',
    rows(doc).join(' | '));

  H.usesEnabled = false;
  hover(72, { ctrlKey: true });
  check('switched off, holding the key shows only the meaning', rows(doc).length === 2);
  H.usesEnabled = true;

  H.usesModifier = 'alt';
  hover(73, { ctrlKey: true });
  check('another key can be chosen', rows(doc).length === 2);
  hover(74, { altKey: true });
  check('and works', rows(doc)[3] === 'EV: used 3 times:');
  const altUp = key('Alt', { code: 'AltLeft' });
  H._onReaderKeyUp(doc, altUp);
  check('letting go of Alt does not move the keyboard to the menu bar (Windows, Linux)', altUp.defaultPrevented);
  H._forgetHover(doc);
  const altAlone = key('Alt', { code: 'AltLeft' });
  H._onReaderKeyUp(doc, altAlone);
  check('but with no tooltip on screen, Alt is left to the menu bar', !altAlone.defaultPrevented);
  H.usesModifier = 'ctrl';

  // ---------- each tooltip on its own, whatever the others are set to ----------
  {
    word = 'TP53';
    H.usesEnabled = false;
    H.databaseLinksEnabled = true;
    H.tooltipModifier = 'shift';
    H.databaseLinksModifier = 'none';
    hover(90);
    check('links set to "Always" show while meanings need a key', shown() && rows(doc)[0] === 'TP53 — look it up in a database',
      shown() && rows(doc)[0]);
    H.databaseLinksModifier = 'alt';
    H._refreshHoverFromLastState(doc);   // what a changed setting does
    hover(91);
    check('links on Alt (Option) do not show without it', !shown());
    hover(92, { altKey: true });
    check('and show while it is held, though meanings need Shift', shown() && rows(doc)[0] === 'TP53 — look it up in a database');
    H.hoverEnabled = false;
    hover(93, { altKey: true });
    check('with meanings switched off, links still work', shown() && rows(doc)[0] === 'TP53 — look it up in a database');
    H.usesEnabled = true;
    hover(94, { ctrlKey: true });
    check('and so does where a word is used', shown() && rows(doc)[0] === 'TP53 — where it is used', shown() && rows(doc)[0]);
    H.hoverEnabled = true;
    H.tooltipModifier = 'none';
  }

  // ---------- tooltips that share a key show as one ----------
  {
    const PAPER = 'The epidermal growth factor receptor (EGFR) was blocked. EGFR levels fell.\n\n\n\fEGFR returned on day 3.';
    H.textCache.set(5, PAPER);
    H._setActiveHoverPairs(5, [{ abbr: 'EGFR', term: 'epidermal growth factor receptor', certainty: 'defined' }]);
    H.tooltipModifier = 'shift';
    H.databaseLinksModifier = 'shift';
    H.usesModifier = 'shift';
    word = 'EGFR';
    hover(100);
    check('all three on Shift: nothing without it', !shown());
    hover(101, { shiftKey: true });
    const r = rows(doc);
    const on = bundled.databases.filter(d => d.enabled !== false).map(d => d.label);
    check('with it, one tooltip: the meaning, then a line, the links, a line, the uses, and how to choose',
      r[0] === 'EGFR — epidermal growth factor receptor' && r[1] === 'Defined in this paper' && r[2] === ''
      && r[3].startsWith('1HGNC2UniProt') && r[4] === '' && r[5] === 'Used 3 times:'
      && r[7] === 'Click one, or press its number.' && r.length === 8, r.join(' | '));
    const uses = tip(doc).childNodes[6].childNodes.map(c => c.childNodes[0].textContent);
    check('numbers run on from the links to the uses, and the tenth is 0', on.length === 7
      && uses.join(',') === '8,9,0', uses.join(','));
    const lines = tip(doc).childNodes.filter((c, i) => i === 2 || i === 4);
    check('the lines between the parts are thin rules', lines.every(l => /1px solid/.test(l.style.borderTop)));
    const before = env.reader.calls.length;
    const zero = key('0', { code: 'Digit0' });
    H._onReaderKeyDown(doc, zero);
    await wait(5);
    check('pressing 0 goes to the tenth choice, the third use', zero.defaultPrevented
      && env.reader.calls.length === before + 1 && env.reader.calls[before].pageIndex === 1, JSON.stringify(env.reader.calls));

    H.tooltipModifier = 'none';
    hover(102);
    check('meanings always, links and uses on Shift: the meaning alone without it', rows(doc).length === 2);
    hover(103, { shiftKey: true });
    check('and all three with it', rows(doc).length === 8);
    H.databaseLinksOnAbbreviations = false;
    H._refreshHoverFromLastState(doc);
    hover(104, { shiftKey: true });
    check('"Also show them under a meaning" off: the links stay away from a word with a meaning',
      rows(doc).length === 6 && rows(doc)[3] === 'Used 3 times:', rows(doc).join(' | '));
    H.databaseLinksOnAbbreviations = true;
    H.databaseLinksEnabled = false;
    H.usesModifier = 'ctrl';
    H.textCache.set(5, TEXT);
    H._setActiveHoverPairs(5, [{ abbr: 'EV', term: 'extracellular vesicle', certainty: 'defined' }]);
  }

  // ---------- keys pressed with the focus outside the paper ----------
  {
    const listeners = {};
    const win = { closed: false, addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } };
    H._followKeysIn(win);
    H._followKeysIn(win);
    check('a main window follows the modifier keys too, once', typeof listeners.keydown === 'function'
      && H.keyWindows.length === 1);
    word = 'KD';
    hover(110);
    listeners.keydown({ key: 'Control', ctrlKey: true });
    check('pressing the key there shows the tooltip without moving the mouse', shown() && rows(doc)[0] === 'KD — where it is used');
    listeners.keyup({ key: 'Control', ctrlKey: false });
    await wait(150);
    check('and letting go hides it', !shown());
    // A number pressed with the tooltip's key passes through the main
    // window first: it is taken there, before Zotero switches tabs, and the
    // page's own listener leaves it alone.
    hover(111, { ctrlKey: true });
    const calls = env.reader.calls.length;
    let stopped = false;
    const n1 = key('1', { code: 'Digit1', ctrlKey: true, stopImmediatePropagation() { stopped = true; } });
    listeners.keydown(n1);
    H._onReaderKeyDown(doc, n1);
    await wait(5);
    check('the main window takes a number meant for the tooltip, once, ahead of Zotero',
      n1.defaultPrevented && stopped && env.reader.calls.length === calls + 1);
    H._removeHoverListeners();
    check('switching off stops following them', !listeners.keydown && H.keyWindows.length === 0);
  }

  // ---------- one look and one way of choosing for all three tooltips ----------
  {
    H._forgetHover(doc);
    const heads = [];
    const opened = [];
    H._openExternalURL = url => opened.push(url);
    const groups = [{ groupLabel: 'Gene/protein databases', links: [{ label: 'HGNC', url: 'u1' }, { label: 'UniProt', url: 'u2' }] },
      { groupLabel: 'Cell line databases', links: [{ label: 'Cellosaurus', url: 'u3' }] }];
    H._showTooltip(doc, 10, 10, { word: 'EGFR', meaning: { term: 'epidermal growth factor receptor', certainty: 'defined' }, links: groups });
    heads.push(tip(doc).childNodes[0]);
    check('1 · a meaning with links: a line, then one row of numbered databases, no group names',
      rows(doc).join(' | ') === 'EGFR — epidermal growth factor receptor | Defined in this paper |  | 1HGNC2UniProt3Cellosaurus'
        + ' | Click one, or press its number.', rows(doc).join(' | '));
    H._onReaderKeyDown(doc, key('3', { code: 'Digit3' }));
    check('pressing 3 opens the third link', opened.join() === 'u3', opened.join());

    H._showTooltip(doc, 10, 10, { word: 'TP53', links: groups });
    heads.push(tip(doc).childNodes[0]);
    check('2 · database links alone: the same heading, row and hint',
      rows(doc).join(' | ') === 'TP53 — look it up in a database | 1HGNC2UniProt3Cellosaurus | Click one, or press its number.',
      rows(doc).join(' | '));
    const linkBadge = tip(doc).childNodes[1].childNodes[0].childNodes[0].style;

    word = 'KD';
    hover(130, { ctrlKey: true });
    heads.push(tip(doc).childNodes[0]);
    const useBadge = tip(doc).childNodes[2].childNodes[0].childNodes[0].style;
    check('3 · uses: the same heading, then numbered choices and the same hint',
      rows(doc)[0] === 'KD — where it is used' && rows(doc)[rows(doc).length - 1] === 'Click one, or press its number.');
    check('every heading is the word in bold, a dash and what the tooltip says',
      heads.every(h => h.childNodes[0].tagName === 'strong' && /^ — /.test(h.childNodes[1].textContent)));
    check('database and use choices are numbered in the same style',
      JSON.stringify(linkBadge) === JSON.stringify(useBadge) && linkBadge.color && linkBadge.fontWeight === '600');
  }

  // ---------- marking the word on its page ----------
  {
    const text = (v, parent) => ({ nodeType: 3, nodeValue: v, parentElement: parent });
    const span = { scrolled: null, scrollIntoView(o) { this.scrolled = o; } };
    const nodes = [text('constant (', span), text('KD', span), text('). More KD here.', span)];
    const marks = [];
    const page = { getBoundingClientRect: () => ({ left: 100, top: 1000 }), appendChild(m) { marks.push(m); m.parentNode = this; return m; },
      removeChild() {} };
    const layer = { textContent: nodes.map(n => n.nodeValue).join(''), closest: () => page, parentNode: page };
    const pdf = {
      querySelector: sel => (sel === '.page[data-page-number="2"] .textLayer' ? layer : null),
      createTreeWalker: () => { let i = -1; return { nextNode: () => nodes[++i] || null }; },
      createRange: () => ({ setStart(n, s) { this.n = n; this.s = s; }, setEnd() {}, get startContainer() { return this.n; },
        getClientRects() { return [{ left: 150 + this.s, top: 1200, width: 20, height: 12 }]; } }),
      createElement: () => ({ style: {}, parentNode: null })
    };
    await H._markUse(pdf, { pageIndex: 1, nthOnPage: 1 }, 'KD');
    check('after a jump, the use is marked on its page', marks.length === 1 && marks[0].style.left === '56px'
      && marks[0].style.top === '198px', JSON.stringify(marks[0] && marks[0].style));
    check('and brought to the middle of the view', span.scrolled && span.scrolled.block === 'center');
    const none = await H._markUse({ querySelector: () => null }, { pageIndex: 0, nthOnPage: 0 }, 'KD').then(() => true);
    check('in Reading Mode (no pages), the jump to the page is all', none);
  }

  H.stop();
  console.log('\n' + (pass ? 'ALL USES TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
