'use strict';
/* "Show where a word is used": finding a word's uses in the text of a PDF,
 * and the key that lists them next to the pointer or goes to the first one,
 * in a faked reader. The finder and the plugin are the real code. */
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

  // ---------- the key in the reader ----------
  let env = makeEnv();
  let H = env.H;
  H.init({ id: 'x', version: '1', rootURI: 'r://' });
  await H._dictionariesReady;
  H.databaseLinksEnabled = false;
  H.textCache.set(5, TEXT);
  H._setActiveHoverPairs(5, [{ abbr: 'EV', term: 'extracellular vesicle', certainty: 'defined' }]);
  let doc = makeDoc();
  let word = 'KD';
  H._wordAtPoint = () => word;
  const hover = (x) => H._onReaderMouseMove(doc, { clientX: x || 50, clientY: 50, target: null });
  const press = async (k, extra) => { const e = key(k, extra); H._onReaderKeyDown(doc, e); await wait(5); return e; };

  hover();
  check('no meaning, so hovering KD shows nothing', !tip(doc) || tip(doc).style.display === 'none');
  let e = await press('o');
  check('the key is taken', e.defaultPrevented);
  check('pressing O over KD lists where it is used', tip(doc) && tip(doc).style.display === 'block'
    && rows(doc)[0] === 'KD — no meaning found' && rows(doc)[1] === 'Used 3 times:', rows(doc).slice(0, 2).join(' | '));
  const choice = i => tip(doc).childNodes[2].childNodes[i];
  check('each use is a numbered choice with its page and words, the word in bold',
    choice(0).textContent === '1p. 2 · The binding was measured as a dissociation constant (KD).'
    && choice(0).childNodes[0].textContent === '1' && choice(0).childNodes[3].tagName === 'strong', choice(0).textContent);
  check('and the tooltip says how to choose', rows(doc)[3] === 'Click one, or press its number.', rows(doc)[3]);
  check('the list can be clicked', tip(doc).style.pointerEvents === 'auto');

  H._onReaderKeyDown(doc, { key: 'Shift', shiftKey: true });
  check('pressing a modifier keeps the list open', rows(doc)[0] === 'KD — no meaning found');
  hover(51);
  check('moving within the word keeps it too', rows(doc)[0] === 'KD — no meaning found');

  e = await press('2', { code: 'Digit2' });
  check('a number goes to that use', env.reader.calls.length === 1 && env.reader.calls[0].pageIndex === 2,
    JSON.stringify(env.reader.calls));
  check('and closes the list', tip(doc).style.display === 'none');

  hover(60);
  await press('o');
  tip(doc).childNodes[2].childNodes[0]._click({ preventDefault() {}, stopPropagation() {} });
  await wait(5);
  check('clicking a use goes there', env.reader.calls.length === 2 && env.reader.calls[1].pageIndex === 1);

  word = 'EVs';
  hover(70);
  await press('O', { shiftKey: true });
  check('over an abbreviation with a meaning, the list says the meaning and finds every form',
    rows(doc)[0] === 'EV — extracellular vesicle' && rows(doc)[1] === 'Used 3 times:', rows(doc).slice(0, 2).join(' | '));
  word = 'binding';
  hover(90);
  check('moving to another word closes the list', !H.usesWindow);

  const ignored = [key('o', { ctrlKey: true }), key('o', { metaKey: true }), key('o', { altKey: true }),
    key('o', { repeat: true }), key('o', { target: { tagName: 'INPUT' } }), key('x')];
  hover(100);
  for (const k of ignored) H._onReaderKeyDown(doc, k);
  await wait(5);
  check('with Ctrl, Cmd or Alt, repeated, in a text field, or another key: left alone',
    ignored.every(k => !k.defaultPrevented) && !H.usesWindow);

  H.usesEnabled = false;
  e = await press('o');
  check('switched off, the key is left alone', !e.defaultPrevented && !H.usesWindow);
  H.usesEnabled = true;

  H.usesKey = 'w';
  word = 'KD';
  hover(110);
  e = await press('o');
  check('another key can be chosen', !e.defaultPrevented);
  e = await press('w');
  check('and works', e.defaultPrevented && !!H.usesWindow);

  H.usesAction = 'jump';
  H._forgetHover(doc);
  hover(120);
  await press('w');
  check('"goes to the first use" goes straight there', env.reader.calls.length === 3 && env.reader.calls[2].pageIndex === 1
    && !H.usesWindow, JSON.stringify(env.reader.calls[2]));

  // ---------- one look and one way of choosing for all three tooltips ----------
  {
    H._forgetHover(doc);
    const heads = [];
    const opened = [];
    H._openExternalURL = url => opened.push(url);
    const groups = [{ groupLabel: 'Gene/protein databases', links: [{ label: 'HGNC', url: 'u1' }, { label: 'UniProt', url: 'u2' }] },
      { groupLabel: 'Cell line databases', links: [{ label: 'Cellosaurus', url: 'u3' }] }];
    H._showHoverTooltip(doc, 10, 10, 'EGFR', 'epidermal growth factor receptor', { groups, certainty: 'defined' });
    heads.push(tip(doc).childNodes[0]);
    const meaningChoices = tip(doc).childNodes.filter(c => c.childNodes.length && c.childNodes[0].childNodes
      && c.childNodes[0].childNodes[0] && c.childNodes[0].childNodes[0].style && c.childNodes[0].childNodes[0].style.fontWeight === '600');
    check('1 · a meaning with links: groups named, numbers run on across them',
      rows(doc).join(' | ') === 'EGFR — epidermal growth factor receptor | Defined in this paper | Gene/protein databases | 1HGNC2UniProt'
        + ' | Cell line databases | 3Cellosaurus | Click one, or press its number.', rows(doc).join(' | '));
    H._onReaderKeyDown(doc, key('3', { code: 'Digit3' }));
    check('pressing 3 opens the third link, in the second group', opened.join() === 'u3', opened.join());

    H._showDatabaseTooltip(doc, 10, 10, { symbol: 'TP53', groups });
    heads.push(tip(doc).childNodes[0]);
    check('2 · database links alone: the same heading, groups and hint',
      rows(doc).join(' | ') === 'TP53 — look it up in a database | Gene/protein databases | 1HGNC2UniProt'
        + ' | Cell line databases | 3Cellosaurus | Click one, or press its number.', rows(doc).join(' | '));
    const linkBadge = tip(doc).childNodes[2].childNodes[0].childNodes[0].style;

    H.usesAction = 'list';
    H.usesKey = 'o';
    word = 'KD';
    hover(130);
    await press('o');
    heads.push(tip(doc).childNodes[0]);
    const useBadge = tip(doc).childNodes[2].childNodes[0].childNodes[0].style;
    check('3 · uses: the same heading, then numbered choices and the same hint',
      rows(doc)[0] === 'KD — no meaning found' && rows(doc)[rows(doc).length - 1] === 'Click one, or press its number.');
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
