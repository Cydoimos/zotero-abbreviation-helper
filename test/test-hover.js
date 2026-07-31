'use strict';
// Paths are anchored to this file so tests can be run from any directory.
const SRC_DIR = require('path').join(__dirname, '..', 'src');
/* Smoke test for the tooltip rendering paths, which the detector diff test does
 * not cover. Uses a minimal fake DOM to check the methods still build a tooltip
 * and wire up database links after the hoverKey removal. */
const fs = require('fs'), vm = require('vm');

function makeDoc() {
  const mk = (tag) => ({
    tagName: tag, style: {}, dataset: {}, childNodes: [], children: [],
    textContent: '', id: '', href: '', target: '', rel: '',
    appendChild(c) { this.childNodes.push(c); this.children.push(c); if (c.textContent) this.textContent += c.textContent; return c; },
    removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); this.children = this.children.filter(x => x !== c); },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this[k] = v; }, contains() { return false; },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
    get firstChild() { return this.childNodes[0] || null; }
  });
  const body = mk('body');
  const store = {};
  return {
    body,
    defaultView: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    createElement: (t) => mk(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: (id) => store[id] || null,
    _register(el) { store[el.id] = el; },
    createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [] })
  };
}

const code = fs.readFileSync(__dirname + '/../src/abbreviation.js', 'utf8');
const sb = { globalThis: {}, Zotero: { debug() {}, launchURL() {} }, console };
vm.createContext(sb); vm.runInContext(code + '\n;this.__H=AbbreviationHelper;', sb);
const H = sb.__H;

let pass = true;
const check = (n, c, d) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (d ? '  ' + d : '')); if (!c) pass = false; };

const doc = makeDoc();
// _ensureHoverTooltip appends to body; make getElementById find it afterwards.
const origEnsure = H._ensureHoverTooltip.bind(H);
H._ensureHoverTooltip = function (d) { const tip = origEnsure(d); if (d._register) d._register(tip); return tip; };

// 1) Plain abbreviation tooltip.
H._showHoverTooltip(doc, 100, 100, 'PDT', 'photodynamic therapy', {});
let tip = doc.getElementById('abbreviation-helper-tooltip');
check('abbreviation tooltip created', !!tip);
check('tooltip is visible', tip && tip.style.display === 'block', 'display=' + (tip && tip.style.display));
check('tooltip shows abbreviation and term', tip && /PDT/.test(tip.textContent) && /photodynamic/.test(tip.textContent));
check('plain tooltip marked non-interactive', tip && tip.dataset.abbreviationHelperInteractive === 'false');

// 2) Abbreviation tooltip with database links.
H.dictionaries = require('../src/data/abbreviations.json');
const info = H._lookupDatabaseLinks('EGFR');
check('database lookup returns groups', !!(info && info.groups && info.groups.length),
  'groups=' + (info && info.groups ? info.groups.length : 0));
H._showHoverTooltip(doc, 120, 120, 'EGFR', 'epidermal growth factor receptor', { groups: info.groups });
tip = doc.getElementById('abbreviation-helper-tooltip');
check('tooltip with links is interactive', tip && tip.dataset.abbreviationHelperInteractive === 'true');
check('link shortcuts registered', H.activeGeneLinks.length > 0, 'n=' + H.activeGeneLinks.length);

// 3) Database-only tooltip (the signature that lost its hoverKey argument).
H._showDatabaseTooltip(doc, 140, 140, info);
tip = doc.getElementById('abbreviation-helper-tooltip');
check('database-only tooltip renders', !!tip && tip.style.display === 'block');
check('database-only tooltip is interactive', tip && tip.dataset.abbreviationHelperInteractive === 'true');

// 4) Hide path clears state.
H._hideHoverTooltip(doc);
check('tooltip hidden', tip.style.display === 'none');
check('link shortcuts cleared', H.activeGeneLinks.length === 0);

// 5) Hover map still resolves plurals/variants.
H._setActiveHoverPairs(1, [{ abbr: 'EV', term: 'extracellular vesicle' }]);
check('hover map resolves exact', H.activeHoverMap.get('EV') === 'extracellular vesicle');
check('hover map resolves plural', H.activeHoverMap.get('EVs') === 'extracellular vesicle');

console.log('\n' + (pass ? 'ALL HOVER SMOKE TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(pass ? 0 : 1);
