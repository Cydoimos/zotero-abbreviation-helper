'use strict';
/* Regression tests for the fixes from the November 2026 review: singular and
 * plural forms in your own definitions and the ignore list, what the tooltip
 * shows for a hovered word, words joined by slashes, and the store of
 * definitions from other papers (supplements, forgetting, overlapping saves).
 * Zotero and the file system are faked; the detector is the real one. */
const SRC_DIR = require('path').join(__dirname, '..', 'src');
const fs = require('fs'), vm = require('vm');
const bundled = JSON.parse(fs.readFileSync(SRC_DIR + '/data/abbreviations.json', 'utf8'));
const LIBRARY = '/zotero/abbreviation-helper/library-definitions.json';

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeEnv(files) {
  const FS = Object.assign({}, files);
  let writing = 0, overlapped = false;
  const io = {
    async exists(p) { return Object.prototype.hasOwnProperty.call(FS, p); },
    async makeDirectory() {},
    async readUTF8(p) { if (!(p in FS)) throw new Error('ENOENT'); return FS[p]; },
    async writeUTF8(p, s) {
      if (p === LIBRARY && writing++) overlapped = true;
      await wait(5);
      FS[p] = s;
      if (p === LIBRARY) writing--;
    },
    async remove(p) { delete FS[p]; }
  };
  const sb = {
    globalThis: {}, console, IOUtils: io, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => bundled }),
    Zotero: { debug() {}, alert() {}, DataDirectory: { dir: '/zotero' }, Prefs: { get() {}, set() {} } }
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(SRC_DIR + '/abbreviation.js', 'utf8') + '\n;this.__H=AbbreviationHelper;', sb);
  return { H: sb.__H, sb, FS, overlapped: () => overlapped };
}

/* Just enough DOM for a tooltip. */
function makeDoc() {
  const store = {};
  const mk = tag => ({
    tagName: tag, style: {}, dataset: {}, childNodes: [], id: '', parentNode: null,
    get textContent() { return this._text || this.childNodes.map(c => c.textContent).join(''); },
    set textContent(t) { this._text = t; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); if (c.id) store[c.id] = c; return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); c.parentNode = null; if (store[c.id] === c) delete store[c.id]; },
    addEventListener() {}, setAttribute(k, v) { this[k] = v; }, contains() { return false; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
    get firstChild() { return this.childNodes[0] || null; }
  });
  const body = mk('body');
  return {
    body, defaultView: { innerWidth: 1200, innerHeight: 800 },
    createElement: mk, createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    getElementById: id => store[id] || null
  };
}
const tip = doc => doc.getElementById('abbreviation-helper-tooltip');

(async () => {
  const { H, sb } = makeEnv({});
  const dicts = { staticDefs: bundled.staticDefs, commonKnownDefs: bundled.commonKnownDefs };
  const detect = (text, extra) => sb.detectAbbreviations(text, Object.assign({}, dicts, extra));
  const realWordAtPoint = H._wordAtPoint;
  check('the line saying where a meaning comes from is on by default', H.showMeaningSource === true);
  const EVS = 'We isolated extracellular vesicles (EVs) from plasma. EVs were counted. The EVs were lysed.';

  // ---------- singular and plural in your own entries ----------
  check('ignoring "EV" also hides a paper\'s "EVs"', !detect(EVS, { ignore: ['EV'] }).length);
  check('ignoring "EVs" also hides a paper\'s "EV"',
    !detect('An extracellular vesicle (EV) was seen. EV size varied. EV counts rose.', { ignore: ['EVs'] }).length);
  const mine = detect(EVS, { userDefs: { EV: 'my vesicle' } });
  check('your definition of "EV" applies to a paper that writes "EVs"',
    mine.length === 1 && mine[0].term === 'my vesicle' && mine[0].certainty === 'user', JSON.stringify(mine));

  // ---------- what the tooltip shows ----------
  {
    const doc = makeDoc();
    H.databaseLinksEnabled = false;
    H._setActiveHoverPairs(1, detect('DNA was cut. DNA was purified. Cells were DNA-positive.'));
    H._wordAtPoint = () => 'DNA.';
    H._onReaderMouseMove(doc, { clientX: 50, clientY: 50, target: null });
    check('the tooltip names the abbreviation without the full stop after it',
      tip(doc) && /^DNA — /.test(tip(doc).childNodes[0].textContent), tip(doc) && tip(doc).childNodes[0].textContent);
    check('"Ignore an Abbreviation…" offers the short form as detected', H.lastHoveredToken === 'DNA', H.lastHoveredToken);

    H._wordAtPoint = () => 'DNA-positive';
    H._onReaderMouseMove(doc, { clientX: 60, clientY: 60, target: null });
    const lines = tip(doc).childNodes.map(c => c.textContent);
    check('an affixed form keeps the meaning readable', lines[0] === 'DNA-positive — deoxyribonucleic acid-positive', lines[0]);
    check('and keeps where the meaning comes from', /^Common term/.test(lines[1]), lines[1]);

    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'green fluorescent protein', certainty: 'user' }]);
    H._wordAtPoint = () => 'GFP';
    H._onReaderMouseMove(doc, { clientX: 70, clientY: 70, target: null });
    check('your own definition is labelled as yours', tip(doc).childNodes[1].textContent === 'Your own definition');
    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'green fluorescent protein', certainty: 'defined' }]);
    H._onReaderMouseMove(doc, { clientX: 71, clientY: 71, target: null });
    check('the same words defined by the paper are labelled as the paper\'s',
      tip(doc).childNodes[1].textContent === 'Defined in this paper');
  }

  // ---------- words joined by slashes ----------
  {
    H._wordAtPoint = realWordAtPoint;
    H._setActiveHoverPairs(1, [{ abbr: 'CD4', term: 'cluster of differentiation 4' },
      { abbr: 'CD8', term: 'cluster of differentiation 8' }, { abbr: 'LC-MS/MS', term: 'tandem mass spectrometry' }]);
    const textNode = { nodeType: 3, nodeValue: 'markers CD4/CD8 and LC-MS/MS were' };
    const docAt = offset => ({
      caretPositionFromPoint: () => ({ offsetNode: textNode, offset }),
      createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [{ left: 0, right: 999, top: 0, bottom: 999 }] })
    });
    const word = offset => H._wordAtPoint(docAt(offset), 10, 10, null);
    check('hovering "CD4" in "CD4/CD8" explains CD4', word(9) === 'CD4', word(9));
    check('hovering "CD8" in "CD4/CD8" explains CD8', word(13) === 'CD8', word(13));
    check('a slashed abbreviation of its own stays whole', word(24) === 'LC-MS/MS', word(24));
  }

  // ---------- definitions from other papers ----------
  {
    const env = makeEnv({});
    env.H.init({ id: 'x', version: '1', rootURI: 'r://' });
    await env.H._dictionariesReady; await env.H._libraryReady;
    const main = { libraryID: 1, key: 'MAIN0001', parentKey: 'PAPER001' };
    const supplement = { libraryID: 1, key: 'SUPP0001', parentKey: 'PAPER001' };
    const other = { libraryID: 1, key: 'OTHR0001', parentKey: 'PAPER002' };
    env.H._detectAbbreviations('We measured the zinc zap tool (ZZT) twice. ZZT rose.', main);
    const fromSupplement = env.H._detectAbbreviations('The zinc and the zap of the tool. ZZT here. ZZT there.', supplement)
      .find(p => p.abbr === 'ZZT');
    check('a paper\'s supplement does not count as another paper', !fromSupplement || fromSupplement.certainty !== 'library',
      fromSupplement && fromSupplement.term);
    env.H._detectAbbreviations('The zinc zap tool (ZZT) again. ZZT fell.', supplement);
    const counted = env.H._detectAbbreviations('The zinc and the zap of the tool. ZZT here. ZZT there.', other)
      .find(p => p.abbr === 'ZZT');
    check('two PDFs of one paper count as one paper', counted && /from another paper/.test(counted.term), counted && counted.term);
    check('Settings can say how many papers were learned from', env.H._libraryPaperCount() === 1);

    env.H._flushLibrary();
    env.H._scheduleLibrarySave();
    env.H._flushLibrary();
    await wait(40);
    check('saves never overlap', !env.overlapped());
    check('the file is written', !!env.FS[LIBRARY]);

    env.H._detectAbbreviations('A new probe tool (NPT) was used. NPT twice.', { libraryID: 1, key: 'NEW00001' });
    await env.H._forgetLibrary();
    await wait(env.H.LIBRARY_SAVE_DELAY + 50);
    check('"Forget learned definitions" empties memory', env.H._libraryPaperCount() === 0);
    check('and the file, which a pending save does not bring back', !env.FS[LIBRARY], env.FS[LIBRARY]);
  }

  // ---------- the line saying where a meaning comes from can be hidden ----------
  {
    const doc = makeDoc();
    H._wordAtPoint = () => 'GFP';
    H._setActiveHoverPairs(1, [{ abbr: 'GFP', term: 'green fluorescent protein', certainty: 'defined' }]);
    H.showMeaningSource = false;
    H._onReaderMouseMove(doc, { clientX: 80, clientY: 80, target: null });
    check('the source line can be switched off', tip(doc).childNodes.length === 1
      && tip(doc).childNodes[0].textContent === 'GFP — green fluorescent protein', tip(doc).childNodes.map(c => c.textContent).join(' | '));
    H.showMeaningSource = true;
  }

  // ---------- a highlight drawn over the words (Reading Mode) ----------
  {
    H._wordAtPoint = realWordAtPoint;
    H._setActiveHoverPairs(1, [{ abbr: 'EGFR', term: 'epidermal growth factor receptor' }]);
    // One line of text, 10 px per character, under a highlight box.
    const text = { nodeType: 3, nodeValue: 'binding of EGFR ligands' };
    const paragraph = { nodeType: 1, childNodes: [text], closest: () => null };
    const highlight = { nodeType: 1, childNodes: [], closest: () => null };
    const doc = {
      caretPositionFromPoint: () => ({ offsetNode: highlight, offset: 0 }),
      elementsFromPoint: () => [highlight, paragraph],
      createRange: () => ({
        setStart(n, s) { this.s = s; }, setEnd(n, e) { this.e = e; },
        getClientRects() { return [{ left: this.s * 10, right: this.e * 10, top: 0, bottom: 20 }]; }
      })
    };
    check('a word under a highlight is still found', H._wordAtPoint(doc, 125, 10) === 'EGFR', H._wordAtPoint(doc, 125, 10));
    check('blank space under a highlight finds nothing', H._wordAtPoint(doc, 125, 40) === '');
    check('a dash at the edge of a word is not part of it', H._lookupHover('EGFR-') && H._lookupHover('EGFR-').abbr === 'EGFR');
  }

  // ---------- keys ----------
  {
    const shown = makeDoc(), focused = makeDoc();
    const opened = [];
    H._openExternalURL = url => opened.push(url);
    const showLinks = () => H._showTooltip(shown, 10, 10, { word: 'EGFR',
      links: [{ groupLabel: 'Databases', links: [{ label: 'A', url: 'u1' }, { label: 'B', url: 'u2' }] }] });
    const key = (k, code, target) => H._onReaderKeyDown(focused,
      { key: k, code, target: target || {}, preventDefault() {}, stopPropagation() {} });
    showLinks();
    key('"', 'Digit2');
    check('Shift+2 on a German keyboard opens link 2', opened.join() === 'u2', opened.join());
    key('é', 'Digit2');
    check('the 2 key on a French keyboard opens link 2', opened.join() === 'u2,u2', opened.join());
    key('2', 'Digit2', { tagName: 'INPUT' });
    check('typing a digit into a field is left alone', opened.length === 2);
    key('Escape', 'Escape');
    check('Escape hides the tooltip even when another page has the focus', tip(shown).style.display === 'none');

    const doc = makeDoc();
    H._wordAtPoint = () => 'EGFR';
    H._onReaderMouseMove(doc, { clientX: 10, clientY: 10, target: null });
    let renders = 0;
    const render = H._renderHoverFromState;
    H._renderHoverFromState = function (s) { renders++; return render.call(this, s); };
    const mod = (down, repeat) => (down ? H._onReaderKeyDown : H._onReaderKeyUp).call(H, doc,
      { key: 'Shift', shiftKey: down, repeat });
    mod(true); mod(true, true); mod(true, true);
    check('holding Shift redraws the tooltip once, not on every repeat', renders === 1, renders + ' redraws');
    mod(false); mod(false);
    check('and releasing it once more', renders === 2, renders + ' redraws');
    H._renderHoverFromState = render;
  }

  // ---------- the Settings pane ----------
  {
    const css = fs.readFileSync(SRC_DIR + '/settings.css', 'utf8');
    check('sections are separated by a line, as in Zotero\'s own panes',
      /groupbox:not\(:first-of-type\)\s*\{[^}]*border-top:\s*var\(--material-panedivider/.test(css));
    // A comma outside var() makes a colour declaration invalid, and it is dropped.
    const colours = (css.replace(/var\([^)]*\)/g, 'v').match(/\bcolor:[^;]*/g) || []);
    check('error messages have a valid colour', colours.length && colours.every(c => !c.includes(',')), colours.join(' | '));
    const xhtml = fs.readFileSync(SRC_DIR + '/settings.xhtml', 'utf8');
    check('the pane offers to forget learned definitions', /id="abbrev-settings-library-forget"/.test(xhtml));
  }

  console.log('\n' + (pass ? 'ALL REVIEW TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
