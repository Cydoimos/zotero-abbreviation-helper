/*
 * Abbreviation Helper — main implementation.
 *
 * Extracts abbreviation/definition pairs from the PDF open in the Zotero
 * reader, so a paper can be skimmed without hunting for where each term was
 * defined. Three kinds of tooltips appear over the words of the paper:
 *   1 · the meaning of an abbreviation,
 *   2 · database lookup links (gene/protein, cell line, chemical) for
 *       code-like names,
 *   3 · where a word is used in the paper, to go there.
 * Each is switched on and off on its own and shown while pointing or while
 * its key is held; those shown at the same moment are one tooltip, in parts.
 *
 * Layout of this file:
 *
 *   1. Detection           detectAbbreviations() and its helpers: pure
 *                          functions with no dependency on Zotero or on
 *                          plugin state, built once at load time.
 *   2. Where a word is     findUses() and its helpers, pure as well.
 *      used
 *   3. AbbreviationHelper  Everything stateful, grouped into sections:
 *                            - preference pane and preferences
 *                            - dictionaries (bundled + user-editable)
 *                            - Zotero UI (Tools menu)
 *                            - the abbreviations file, edited from Settings
 *                            - scanning and PDF text extraction
 *                            - abbreviation detection
 *                            - definitions from the user's other papers
 *                            - hover: listeners and the word under the pointer
 *                            - database lookup links
 *                            - the three tooltips, built alike
 *                            - where a word is used: going to a use
 *                            - the tooltip element, clicks and keys
 *
 * Detection pairs every short form with the text next to it and keeps the
 * pair only if the short form's letters align with that text (an extension of
 * Schwartz & Hearst, 2003; see the detection section). Precision is favoured
 * over recall: a candidate that cannot be aligned with its long form is
 * dropped rather than guessed at.
 */

/* ============================================================================
 * Abbreviation detection
 *
 * Pure functions with no dependency on Zotero or on plugin state, built once
 * when the plugin loads. The entry point is detectAbbreviations(text, dicts).
 *
 * The method follows Schwartz & Hearst (2003): a short form is paired with the
 * words next to it, and the pair is kept only if the short form's letters can
 * be found, in order, in those words. Where the original takes the shortest
 * span that contains the letters, every possible span is scored here and the
 * best one wins: a letter at the start of a word scores most, a letter inside
 * a word less, and a word that contributes no letter counts against the span.
 * So "mitochondrial inner membrane potential (MMP)" keeps all four words and
 * "Translocase of the Outer Membrane (TOM)" no longer matches T to "the".
 *
 * The same scorer judges every place a definition can appear:
 *
 *   forward   long form (SF)       long form [SF]     long form (SF, Fig. 2)
 *   inside    (long form, SF)      (a long form; SF)
 *   reverse   SF (long form)
 *   phrase    long form, hereafter SF      ... abbreviated as SF
 *   key       SF = long form       (table footnotes)
 *   list      Abbreviations: SF, long form; SF, long form ...
 *
 * Nothing is decided in a fixed order and no short form is blocked by a failed
 * attempt: every candidate is scored, and for each short form the most
 * reliable acceptable candidate is kept. What the letters cannot confirm is
 * then filled in, less certain at each step and marked as such:
 *
 *   probable  the words before an abbreviation's first bracket
 *   library   definitions from the user's other papers
 *   common    the curated glossary of well-known abbreviations
 * ============================================================================ */

// ---- characters -------------------------------------------------------------

var GREEK_NAMES = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta',
    'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu',
    'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau',
    'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega'
};
// A digit in a short form may stand for a number word in the long form:
// 5HT five-helix tile, SH2 Src homology two, PIP3 ...trisphosphate,
// IC50 half maximal inhibitory concentration.
var NUMBER_WORDS = {
    1: ['one', 'first', 'mono', 'single', 'uni'],
    2: ['two', 'second', 'di', 'bi', 'double', 'dual'],
    3: ['three', 'third', 'tri'],
    4: ['four', 'fourth', 'tetra', 'quadr'],
    5: ['five', 'fifth', 'penta'],
    6: ['six', 'sixth', 'hexa'],
    7: ['seven', 'hepta'],
    8: ['eight', 'octa'],
    9: ['nine', 'nona'],
    10: ['ten', 'deca'],
    50: ['half']
};
// X stands for "cross" (DX double-crossover, XL crosslinker) or "trans".
var X_WORDS = ['cross', 'trans'];

// ---- words --------------------------------------------------------------------

// Function words: free inside a long form ("Translocase of the Outer
// Membrane"), and only able to supply a letter when capitalised ("The Cancer
// Genome Atlas"). Quantities ("10 mM") are treated the same way.
var FUNCTION_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'in', 'on',
    'at', 'to', 'by', 'with', 'from', 'as', 'into', 'via', 'per', 'its', 'their', 'that',
    'which', 'is', 'are', 'was', 'were', 'be', 'this', 'these', 'we', 'our',
    // in institution names: Institut de ..., Zentrum f\u00fcr ...
    'de', 'des', 'du', 'del', 'della', 'di', 'la', 'le', 'les', 'et', 'y', 'f\u00fcr', 'und', 'der', 'van', 'von']);
// "in vitro", "in vivo": here "in" is part of the term (IVT, IVIS).
var LATIN_AFTER_IN = new Set(['vitro', 'vivo', 'situ', 'silico', 'utero', 'ovo', 'planta', 'cellulo']);
// Words that introduce a long form and are never its first word.
var LEADING_NOISE = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'on', 'at',
    'to', 'by', 'with', 'from', 'as', 'using', 'including', 'namely', 'such', 'its', 'their',
    'our', 'this', 'these', 'via', 'called', 'termed', 'named', 'both', 'between']);
// Bracket contents that are references to the paper itself, not short forms.
var NOT_SHORT_FORMS = new Set(['fig', 'figs', 'figure', 'figures', 'table', 'tables', 'eq',
    'eqs', 'equation', 'ref', 'refs', 'see', 'eg', 'ie', 'cf', 'vs', 'and', 'or', 'the', 'of',
    'in', 'on', 'to', 'is', 'it', 'as', 'at', 'by', 'an', 'be', 'we', 'no', 'not', 'yes',
    'top', 'left', 'right', 'bottom', 'middle', 'inset', 'insets', 'panel', 'step', 'lane',
    'lanes', 'movie', 'video', 'appendix', 'note', 'data', 'text', 'online', 'print']);
// Units and other measures written in brackets after what they measure.
var UNITS = new Set(['mM', 'nM', 'pM', 'fM', 'uM', 'μM', 'µM', 'mg', 'ng', 'pg', 'kg', 'μg', 'µg',
    'mL', 'ml', 'μL', 'µL', 'μl', 'nL', 'nm', 'μm', 'µm', 'mm', 'cm', 'km', 'kDa', 'Da', 'kD',
    'MDa', 'GDa', 'min', 'h', 'hr', 'hrs', 's', 'ms', 'μs', 'ns', 'ps', 'Hz', 'kHz', 'MHz',
    'GHz', 'rpm', 'ppm', 'ppb', 'pH', 'mV', 'kV', 'eV', 'keV', 'MeV', 'mA', 'nA', 'pA', 'mW',
    'kW', 'Gy', 'mGy', 'Sv', 'kb', 'Mb', 'Gb', 'bp', 'nt', 'aa', 'MPa', 'GPa', 'kPa', 'Pa',
    'bar', 'mbar', 'atm', 'Torr', 'cps', 'au', 'AU', 'OD', 'RCF', 'xg', 'wt', 'vol', 'mol',
    'mmol', 'μmol', 'nmol', 'pmol', 'IU', 'U', 'K', 'J', 'kJ', 'kcal', 'cal', 'W', 'N']);
// Long forms that are measurement units are never the answer either, but
// "bp", "nt" and "aa" are real abbreviations when a paper defines them.
var DEFINABLE_UNITS = new Set(['bp', 'nt', 'aa', 'kb', 'Mb', 'Gb', 'au', 'AU', 'OD', 'RCF']);
var ROMAN_NUMERAL = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,2})$/i;

// ---- short forms ----------------------------------------------------------------

/** "EVs" -> "EV"; "" when the final s is part of the short form. */
function singularShortForm(abbr) {
    if (!abbr || abbr.length < 3 || !abbr.endsWith('s')) return '';
    const base = abbr.slice(0, -1);
    // A lowercase plural s after a capital is the common pattern: EVs, NPs.
    if (/\p{Lu}[\p{L}\d]*$/u.test(base) && /\p{Lu}/u.test(base.slice(-2))) return base;
    if (/\p{Lu}/u.test(base) && /\d$/.test(base)) return base;          // GLUT4s
    if (DEFINABLE_UNITS.has(base)) return base;                            // bps, nts
    return '';
}
function pluralShortForms(abbr) {
    if (!abbr || singularShortForm(abbr)) return [];
    return [abbr + 's', abbr + 'S'];
}

/**
 * Could this token be a short form at all? Only the shape is judged here;
 * whether it is one depends on its long form aligning with it.
 *
 * @param {string} sf
 * @param {boolean} [inList] true for entries of an explicit abbreviation list,
 *   which may define ordinary lowercase forms ("aa, amino acid").
 */
function looksLikeShortForm(sf, inList) {
    if (!sf || sf.length < 2 || sf.length > 20) return false;
    if (/[=<>±×≈~@#$%&*{}|\\+]/.test(sf)) return false;
    if (!/^[\p{L}\p{N}]/u.test(sf) || !/[\p{L}\p{N}]$/u.test(sf)) return false;
    const tokens = sf.split(' ');
    // "Pol II", "Chr III", "GSDM D" - never a phrase or a version ("Dfam 2.0").
    if (tokens.length > 2 || (tokens.length === 2 && (tokens[1].length > 4 || tokens[1].includes('.')))) return false;
    // Only lowercase or Title-case tokens can be ordinary words: "AT" is
    // antiterminator and "OR" odds ratio, but "(at)", "(Fig)" and "(Top)" are not.
    if (/\p{Ll}/u.test(tokens[0]) && NOT_SHORT_FORMS.has(tokens[0].replace(/\.$/, '').toLowerCase())) return false;
    // The first word of a two-word short form is itself short-form-like
    // ("Pol II", "LSM 900"), not a quantity or a word ("10 mL", "dataset I").
    if (tokens.length === 2 && !looksLikeShortForm(tokens[0])) return false;
    if (/[,:;]/.test(sf)) return false;
    if (/^\p{Ll}\/\p{Ll}$/u.test(sf)) return false;                            // v/v, w/v
    if (/[\u0370-\u03ff]\p{Ll}{3}/u.test(sf)) return false;                    // αexp: a subscript
    if ((sf.match(/\p{Ll}{4,}/gu) || []).length >= 2) return false;           // GeneiFPKMmale: a variable
    if (ROMAN_NUMERAL.test(sf)) return false;
    if (UNITS.has(sf) && !DEFINABLE_UNITS.has(sf)) return false;
    const letters = (sf.match(/\p{L}/gu) || []).length;
    const alnum = (sf.match(/[\p{L}\p{N}]/gu) || []).length;
    if (letters < 1 || alnum < 2) return false;
    if (/^\d/.test(sf) && /^\d+(?:[.,]\d+)*[a-z]?$/.test(sf)) return false;   // 2019, 3.5, 12a
    const digits = (sf.match(/\d/g) || []).length;
    if (digits >= 4 && digits > letters) return false;                       // sc-17839: a catalogue number
    const upper = (sf.match(/\p{Lu}/gu) || []).length;
    const digit = /\d/.test(sf);
    const greek = /[\u0370-\u03ff]/.test(sf);
    if (upper >= 2) return true;                                   // DNA, PolyIC, iNANO
    if (upper === 1) {
        // One capital: fine when short, mixed with digits or Greek, or when the
        // capital is not the first letter (dCas9, polyUb). A longer Title-case
        // token is an ordinary word ("Methods", "Insets").
        return letters <= 4 || digit || greek || !/^\p{Lu}/u.test(sf);
    }
    // No capitals: "bp", "nt", "p53"; longer lowercase only in explicit lists.
    if (digit || greek) return letters <= 6;
    if (inList) return letters <= 6;
    return letters <= 2 || DEFINABLE_UNITS.has(sf.replace(/s$/, ''));
}

/** The pieces of a short form that must be found in its long form. */
function shortFormUnits(sf) {
    const s = String(sf).normalize('NFC');
    const units = [];
    for (let i = 0; i < s.length;) {
        const ch = s[i];
        if (/\d/.test(ch)) {
            let j = i + 1;
            while (j < s.length && /\d/.test(s[j])) j++;
            units.push({ kind: 'number', text: s.slice(i, j) });
            i = j;
            continue;
        }
        const lower = ch.toLowerCase();
        if (GREEK_NAMES[lower]) units.push({ kind: 'greek', text: lower });
        else if (/\p{L}/u.test(ch)) units.push({ kind: 'letter', text: lower });
        i++;
    }
    return units;
}

// ---- long-form windows -----------------------------------------------------------

/**
 * Split candidate long-form text into words. A bracketed group set off by
 * spaces ("TNF (Tumor Necrosis Factor) Receptor 1") is optional: its words
 * may supply letters but cost nothing when they do not, and an unused group
 * is left out of the result.
 */
function tokenizeLongForm(text) {
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
        words.push({ text: m[0], optional: false, group: -1 });
    }
    // Mark space-delimited bracket groups.
    let depth = 0, groupStart = -1, groups = 0;
    for (let i = 0; i < words.length; i++) {
        const w = words[i].text;
        const opens = (w.match(/[([]/g) || []).length;
        const closes = (w.match(/[)\]]/g) || []).length;
        if (depth === 0 && /^[([]/.test(w) && opens > closes) { groupStart = i; depth = opens - closes; continue; }
        if (depth === 0 && /^[([].*[)\]][,;:.]?$/.test(w) && opens === closes) {
            words[i].optional = true; words[i].group = groups++;     // "(23)", "(TNF)"
            continue;
        }
        if (depth > 0) {
            depth += opens - closes;
            if (depth <= 0) {
                depth = 0;
                if (/[)\]][,;:.]?$/.test(w)) {
                    for (let k = groupStart; k <= i; k++) { words[k].optional = true; words[k].group = groups; }
                    groups++;
                }
                groupStart = -1;
            }
        }
    }
    for (const w of words) {
        const bare = w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
        w.bare = bare;
        w.empty = bare === '';
        w.commaAfter = /[,;]$/.test(w.text);
    }
    words.forEach((w, i) => {
        // "in vitro", "in vivo": the "in" belongs to the term (IVT, IVIS).
        const latin = w.bare === 'in' && i + 1 < words.length && LATIN_AFTER_IN.has(words[i + 1].bare);
        // Quantities ("10 mM", "0.5×") are as neutral as function words.
        w.functionWord = (FUNCTION_WORDS.has(w.bare) || isQuantity(w.text)) && !latin;
        // A capitalised function word in a capitalised name may supply its
        // initial ("The Cancer Genome Atlas", "A Disintegrin And Metalloproteinase").
        w.titled = w.functionWord && /^[^\p{L}]*\p{Lu}/u.test(w.text);
        // Words that introduce a long form are never its first word.
        w.noStart = LEADING_NOISE.has(w.bare) && !latin && !w.titled;
    });
    return words;
}

/** "10", "0.5×", "25%", "mM": a number or unit, not a word of a long form. */
function isQuantity(word) {
    const w = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%×]+$/gu, '');
    return /^[\d.,]*\d(?:[a-zμµ]{1,3}|%|×)?$/i.test(w) || UNITS.has(w);
}

/** Character positions in the words where a short-form unit could match. */
function longFormChars(words) {
    const chars = [];
    words.forEach((w, wi) => {
        const t = w.text.normalize('NFC');
        for (let j = 0; j < t.length; j++) {
            const c = t[j];
            const prev = j ? t[j - 1] : ' ';
            const isLetter = /\p{L}/u.test(c);
            const partStart = /[\p{L}\p{N}]/u.test(c) && (
                j === 0 || !/[\p{L}\p{N}]/u.test(prev) ||
                (isLetter && /\p{Lu}/u.test(c) && /\p{Ll}/u.test(prev)) ||
                (isLetter && /\d/.test(prev)));
            chars.push({ c: c.toLowerCase(), word: wi, partStart, wordText: t, offset: j });
        }
        chars.push({ c: ' ', word: wi, partStart: false, wordText: t, offset: t.length });
    });
    return chars;
}

/** Every way one short-form unit can be matched in the long-form characters. */
function unitMatches(unit, chars, words) {
    const out = [];
    // A letter inside an optional bracketed group is weaker evidence than one
    // in the running text, so ties go to the running text.
    const at = (p, len, base, initial) => out.push({
        p, len, initial, word: chars[p].word,
        base: base - (words[chars[p].word].optional ? ALIGN_IN_BRACKETS : 0)
    });
    const startsWith = (p, s) => {
        const ch = chars[p];
        return ch.wordText.slice(ch.offset).toLowerCase().startsWith(s);
    };
    for (let p = 0; p < chars.length; p++) {
        const ch = chars[p];
        if (ch.c === ' ') continue;
        const fw = words[ch.word].functionWord && !words[ch.word].titled;
        if (unit.kind === 'letter' || unit.kind === 'greek') {
            if (ch.c === unit.text) {
                if (ch.partStart) at(p, 1, fw ? 0.5 : 3, !fw);
                else at(p, 1, 0, false);
            }
            if (!ch.partStart || fw) continue;
            if (unit.kind === 'greek' && startsWith(p, GREEK_NAMES[unit.text])) at(p, GREEK_NAMES[unit.text].length, 3, true);
            if (unit.text === 'x' && X_WORDS.some(x => startsWith(p, x))) at(p, 1, 2.5, true);
        } else {
            // A number: the same digits (not inside a longer number), or a
            // number word at the start of a word part.
            const n = unit.text;
            if (ch.c === n[0] && (p === 0 || !/\d/.test(chars[p - 1].c))) {
                let ok = true;
                for (let k = 1; k < n.length; k++) if (!chars[p + k] || chars[p + k].c !== n[k]) { ok = false; break; }
                if (ok && !(chars[p + n.length] && /\d/.test(chars[p + n.length].c))) at(p, n.length, ch.partStart ? 2 : 1, ch.partStart);
            }
            if (ch.partStart && !fw) {
                for (const word of NUMBER_WORDS[parseInt(n, 10)] || []) {
                    if (startsWith(p, word)) at(p, word.length, 2.5, true);
                }
            }
        }
    }
    return out;
}

var ALIGN_UNMATCHED_WORD = 2;     // a word of the long form that supplies no letter
var ALIGN_COMMA = 1;              // a comma crossed inside the long form
var ALIGN_SKIPPED_NUMBER = 0.5;   // a number of the short form with nothing to match
var ALIGN_SPAN_WORD = 0.1;        // every content word of the span: shorter spans win ties
var ALIGN_IN_BRACKETS = 0.25;     // a letter found inside an optional bracketed group

/**
 * Best alignment of a short form with long-form words.
 *
 * mode 'end'  : the long form must end at the last word (text before a
 *               bracket); where it starts is chosen by the score.
 * mode 'start': the long form must start at the first word (text after
 *               "SF =" or inside brackets); where it ends is chosen.
 * mode 'both' : the long form is exactly the given words.
 *
 * Returns null, or { longForm, quality, unmatched, words, firstWord,
 * lastWord, ... }: quality is the score per matched short-form unit (about 3
 * when every unit starts a word), unmatched the number of content words that
 * supply no letter, words the number of content words in the long form.
 */
function alignLongForm(sf, text, mode) {
    const base = singularShortForm(sf) || sf;
    const allUnits = shortFormUnits(base);
    if (!allUnits.some(u => u.kind !== 'number')) return null;
    const words = tokenizeLongForm(text);
    if (!words.length) return null;
    const chars = longFormChars(words);

    // Prefix sums: content words and commas up to each word index.
    const content = [0], commas = [0];
    words.forEach((w, i) => {
        content.push(content[i] + (w.optional || w.functionWord || w.empty ? 0 : 1));
        commas.push(commas[i] + (w.commaAfter && !w.optional ? 1 : 0));
    });
    const contentBetween = (a, b) => b > a + 1 ? content[b] - content[a + 1] : 0;   // words strictly between
    const commasBetween = (a, b) => b > a ? commas[b] - commas[a] : 0;              // commas after words a..b-1

    // Number units may go unmatched (IC50 -> inhibitory concentration).
    const numberIdx = allUnits.length - allUnits.filter(u => u.kind === 'number').length >= 2
        ? allUnits.map((u, i) => u.kind === 'number' ? i : -1).filter(i => i >= 0) : [];
    let best = null;
    for (let mask = 0; mask < (1 << Math.min(numberIdx.length, 3)); mask++) {
        const skipped = new Set(numberIdx.filter((_, k) => mask & (1 << k)));
        const units = allUnits.filter((_, i) => !skipped.has(i));
        const r = alignUnits(units, words, chars, mode, content, contentBetween, commasBetween);
        if (!r) continue;
        r.score -= ALIGN_SKIPPED_NUMBER * skipped.size;
        // Quality is measured over the units that were matched.
        r.units = units.length;
        if (!best || r.score > best.score) best = r;
    }
    if (!best) return null;
    best.quality = best.score / best.units;
    best.longForm = renderLongForm(words, best);
    if (!best.longForm) return null;
    return best;
}

function alignUnits(units, words, chars, mode, content, contentBetween, commasBetween) {
    const n = units.length;
    if (!n) return null;
    const lastWord = words.length - 1;
    const matches = units.map(u => unitMatches(u, chars, words));
    if (matches.some(m => !m.length)) return null;
    // score[k][j]: best score with unit k at its j-th match; from[k][j]: predecessor.
    const score = [], from = [];
    for (let k = 0; k < n; k++) {
        score.push(new Array(matches[k].length).fill(-Infinity));
        from.push(new Array(matches[k].length).fill(-1));
    }
    matches[0].forEach((m, j) => {
        // The long form starts at the word of the first unit, at its start.
        if (!m.initial && !(chars[m.p].partStart && units[0].kind !== 'letter')) return;
        if (words[m.word].noStart || words[m.word].optional) return;
        // In 'start' and 'both' modes nothing but function words may precede it.
        if (mode !== 'end' && content[m.word] > 0) return;
        score[0][j] = m.base;
        if (mode === 'end') score[0][j] -= ALIGN_SPAN_WORD * (content[lastWord + 1] - content[m.word]);
    });
    for (let k = 1; k < n; k++) {
        for (let j = 0; j < matches[k].length; j++) {
            const b = matches[k][j];
            for (let i = 0; i < matches[k - 1].length; i++) {
                const prev = score[k - 1][i];
                if (prev === -Infinity) continue;
                const a = matches[k - 1][i];
                if (b.p < a.p + a.len) continue;
                let s = b.base;
                // A letter inside a word: worth something when it continues
                // the previous letter (DNA from "DNA"), a little when it is in
                // the same word (phosphoenolpyruvate PEP). A new word that
                // supplies only an inner letter counts as contributing nothing
                // ("medium containing" for Met).
                if (!chars[b.p].partStart) {
                    if (b.word !== a.word) s -= ALIGN_UNMATCHED_WORD;
                    else s += b.p === a.p + a.len ? 1.5 : 0.5;
                }
                s -= ALIGN_UNMATCHED_WORD * contentBetween(a.word, b.word);
                s -= ALIGN_COMMA * commasBetween(a.word, b.word);
                if (prev + s > score[k][j]) { score[k][j] = prev + s; from[k][j] = i; }
            }
        }
    }
    let bestJ = -1, bestScore = -Infinity, bestEnd = lastWord;
    matches[n - 1].forEach((m, j) => {
        if (score[n - 1][j] === -Infinity) return;
        let end = lastWord, s = score[n - 1][j];
        if (mode === 'start') {
            // The long form may stop after its last matched word; dropping the
            // words beyond it costs a little, so a longer good span still wins.
            end = m.word;
            s -= 0.25 * contentBetween(m.word, lastWord + 1) + ALIGN_SPAN_WORD * content[m.word + 1];
        } else {
            s -= ALIGN_UNMATCHED_WORD * contentBetween(m.word, lastWord + 1);
            s -= ALIGN_COMMA * commasBetween(m.word, lastWord);
        }
        if (s > bestScore) { bestScore = s; bestJ = j; bestEnd = end; }
    });
    if (bestJ < 0) return null;
    // Walk back to recover the matched words.
    const used = new Set(), touched = new Set(), usedGroups = new Set();
    let firstWord = 0, firstOffset = 0, j = bestJ;
    for (let k = n - 1; k >= 0; k--) {
        const m = matches[k][j];
        touched.add(m.word);
        if (chars[m.p].partStart) used.add(m.word);
        if (words[m.word].group >= 0) usedGroups.add(words[m.word].group);
        firstWord = m.word;
        firstOffset = chars[m.p].offset;
        j = from[k][j];
    }
    let unmatched = 0, total = 0;
    for (let w = firstWord; w <= bestEnd; w++) {
        const wd = words[w];
        if ((wd.optional && !usedGroups.has(wd.group)) || wd.functionWord || wd.empty) continue;
        total++;
        if (!used.has(w)) unmatched++;
    }
    return { score: bestScore, firstWord, lastWord: bestEnd, unmatched, words: total, usedGroups, touched, firstOffset };
}

/** The long form as written, without unused bracket groups or edge noise. */
function renderLongForm(words, { firstWord: first, lastWord: last, usedGroups, touched, firstOffset }) {
    // Trailing words that supply nothing and mean nothing on their own (page
    // and line numbers, "of") are not part of the long form.
    while (last > first && (words[last].functionWord || words[last].empty) && !touched.has(last)) last--;
    const parts = [];
    for (let i = first; i <= last; i++) {
        const w = words[i];
        if (w.optional && !usedGroups.has(w.group)) continue;
        // An affiliation mark glued to the first word: "1Interdisciplinary", "dInstitut".
        if (i === first && firstOffset > 0 && /^(?:\d+|\p{Ll})$/u.test(w.text.slice(0, firstOffset)) &&
            /^\p{Lu}\p{Ll}{4}/u.test(w.text.slice(firstOffset))) {
            parts.push(w.text.slice(firstOffset));
            continue;
        }
        parts.push(w.text);
    }
    let out = parts.join(' ');
    // Quotes and trailing punctuation are typography, not part of the term.
    out = out.replace(/^[\s"“”‘’'«»,;:=]+|[\s"“”‘’'«»,;:.=]+$/g, '');
    // Unbalanced brackets at the edges: "(Tumor Necrosis" -> "Tumor Necrosis".
    const opens = (out.match(/[([]/g) || []).length, closes = (out.match(/[)\]]/g) || []).length;
    if (opens > closes) out = out.replace(/^[([]\s*/, '');
    if (closes > opens) out = out.replace(/\s*[)\]]$/, '');
    return out.trim();
}

// ---- document preparation ------------------------------------------------------

// Features of a bibliography entry. A line dense in them is part of a
// reference list (or a running header such as "eLife 2022;11:e81856. DOI:").
var CITATION_FEATURES = [
    /\b\d{1,4}\s*[,:]\s*(?:\d{1,5}\s*[\u2013\u2014-]\s*)?\d{1,6}\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g,
    /\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*[A-Z]/g,
    /\b(?:19|20)\d{2}[a-z]?\s*[;,]\s*\d{1,4}\s*(?:\(\s*[\w-]+\s*\))?\s*[:,]\s*\w*\d+/g,
    /\b\d{1,4}\s*\(\s*[\w\u2013-]{1,6}\s*\)\s*:\s*[e\d]/g,
    /\bdoi\b|\bhttps?:\/\/doi\.org|\bPMID\b|\[CrossRef\]|\[PubMed\]|\[Google Scholar\]/gi,
    /\b\p{Lu}[\p{L}'’-]+,\s(?:\p{Lu}\.[\s-]?){1,3}(?=[,&]|\s(?:&|and)\s)/gu,
    /\b\p{Lu}[\p{L}'’-]+\s\p{Lu}{1,3}(?:,\s|\s\(|\.\s)(?=\p{Lu})/gu,
    /\bet al\.\s*(?:\(\s*)?(?:19|20)\d{2}/g
];
function isReferenceLine(line) {
    let n = 0;
    for (const re of CITATION_FEATURES) {
        re.lastIndex = 0;
        const m = line.match(re);
        if (m) n += m.length;
    }
    return n >= 2 && n * 400 >= line.length;
}

// Put where text was removed (reference lines): long forms never cross it.
var BREAK = '\u2029';

/**
 * Running headers and footers ("ACCEPTED MANUSCRIPT", "Page 3 of 12") sit
 * next to page breaks (form feeds) and interrupt sentences that run across
 * pages. A line (up to a long licence footer) found near three or more page
 * breaks is one. Returns the indices of those lines.
 */
function runningHeaderLines(lines) {
    const NEAR = 4;                     // non-empty lines on either side of a break
    const shape = l => l.replace(/\f/g, '').trim().replace(/\d+/g, '#');
    const filled = [];
    lines.forEach((l, i) => { if (l.trim()) filled.push(i); });
    const near = new Set();
    filled.forEach((i, k) => {
        if (!lines[i].includes('\f')) return;
        for (let d = Math.max(0, k - NEAR); d <= Math.min(filled.length - 1, k + NEAR); d++) near.add(filled[d]);
    });
    const count = new Map();
    for (const i of near) count.set(shape(lines[i]), (count.get(shape(lines[i])) || 0) + 1);
    const headers = new Set();
    for (const i of near) {
        const s = shape(lines[i]);
        if (s && s.length <= 250 && count.get(s) >= 3) headers.add(i);
    }
    return headers;
}

/** The lines without running headers; a removed line keeps its page break. */
function dropRunningHeaders(lines) {
    const headers = runningHeaderLines(lines);
    return lines.flatMap((l, i) => !headers.has(i) ? [l] : l.includes('\f') ? ['\f'] : []);
}

/** Soft hyphens, odd spaces and ligatures, as PDF text extraction leaves them. */
function fixCharacters(text) {
    return String(text || '')
        .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, '')
        .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
        .replace(/\ufb00/g, 'ff').replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl')
        .replace(/\ufb03/g, 'ffi').replace(/\ufb04/g, 'ffl').replace(/[\ufb05\ufb06]/g, 'st')
        .normalize('NFC');
}

/**
 * Undo extraction artefacts: soft hyphens, odd spaces, ligatures, and running
 * page headers. Expects the text with a form feed between pages, as Zotero's
 * PDF worker returns it.
 */
function cleanText(text) {
    const cleaned = fixCharacters(text);
    // Page breaks (form feeds) locate the headers. Then the blank lines around
    // a page break are dropped, since a list or paragraph continues on the
    // next page, and the break itself becomes a space.
    const out = [];
    let gap = [], gapHasBreak = false;
    for (const line of dropRunningHeaders(cleaned.split('\n'))) {
        if (!line.replace(/\f/g, '').trim()) {
            gap.push(line);
            gapHasBreak = gapHasBreak || line.includes('\f');
            continue;
        }
        if (!gapHasBreak && !line.includes('\f')) out.push(...gap);
        gap = [];
        gapHasBreak = false;
        out.push(line);
    }
    return out.concat(gap).join('\n').replace(/\f/g, ' ');
}

/**
 * Drop bibliography lines, leaving a BREAK where they were. The rest of the
 * paper is kept: Methods sections often come after the reference list.
 */
function dropReferences(text) {
    const lines = text.split('\n');
    const kind = lines.map(l => l.length < 40 ? null : isReferenceLine(l));
    // Short lines (headings, page numbers) follow their neighbours.
    for (let i = 0; i < lines.length; i++) {
        if (kind[i] !== null) continue;
        let a = i - 1, b = i + 1;
        while (a >= 0 && kind[a] === null) a--;
        while (b < lines.length && kind[b] === null) b++;
        kind[i] = a >= 0 && b < lines.length && kind[a] === true && kind[b] === true;
    }
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (!kind[i]) out.push(lines[i]);
        else if (out[out.length - 1] !== BREAK) out.push(BREAK);
    }
    return out.join('\n');
}

/**
 * How often each word-like token occurs, computed once per paper: `alone`
 * counts tokens as written, `inCompounds` the runs of parts inside compounds
 * ("LC-MS/MS" contains LC-MS and MS, "ATP-dependent" contains ATP). A
 * compound is not split when it is an abbreviation in its own right
 * ("SDS-PAGE"), or when it contains one the paper defines itself
 * ("6HBC-PBS-mature"): its parts may mean something else there, and the
 * paper's own definition already explains them.
 */
function countTokens(text, isAbbreviation, isDefinedHere) {
    const alone = new Map(), inCompounds = new Map();
    const bump = (map, t) => map.set(t, (map.get(t) || 0) + 1);
    const re = /[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}'\u2019\u2032]|[-\u2010\u2011/.](?=[\p{L}\p{N}]))*/gu;
    let m;
    while ((m = re.exec(text))) {
        const token = m[0];
        bump(alone, token);
        const parts = token.split(/([-\u2010\u2011/'\u2019\u2032])/);
        if (parts.length < 3 || parts.length > 11) continue;
        // Every run of parts: single parts ("ATP") and multi-part runs ("LC-MS").
        const pieces = [], multi = [];
        for (let i = 0; i < parts.length; i += 2) {
            for (let j = i; j < parts.length; j += 2) {
                const piece = parts.slice(i, j + 1).join('');
                pieces.push(piece);
                if (j > i) multi.push(piece);
            }
        }
        if (isAbbreviation(token) || multi.some(isDefinedHere)) continue;
        for (const piece of pieces) if (piece && piece !== token) bump(inCompounds, piece);
    }
    return { alone, inCompounds };
}

// ---- finding candidates ------------------------------------------------------------

var LEAD_IN = /^(?:i\.?\s?e\.?|hereafter(?:\s+(?:referred\s+to\s+as|called|termed|named|abbreviated(?:\s+as)?))?|henceforth(?:\s+(?:referred\s+to\s+as|called))?|abbreviated(?:\s+as)?|abbr\.|referred\s+to\s+as|termed|called|named|known\s+as|denoted(?:\s+(?:as|by))?|or|also|short\s+for)\s*[,:]?\s+/i;
var PHRASE_LINK = /(?:,\s+or(?=\s)|(?:,\s*)?\b(?:hereafter(?:\s+(?:referred\s+to\s+as|called|termed|named|abbreviated(?:\s+as)?))?|henceforth(?:\s+(?:referred\s+to\s+as|called))?|abbreviated(?:\s+as)?|referred\s+to\s+as|termed|denoted\s+(?:as|by)))\s+["“‘']?([\p{L}\p{N}][\p{L}\p{N}\-\u2010\u2011/.]{0,18}[\p{L}\p{N}])["”’']?/giu;

/**
 * The text a long form may come from, ending at `end`: back to the start of
 * the sentence, clause, enclosing bracket or removed region.
 */
function windowBefore(text, end) {
    let w = text.slice(Math.max(0, end - 260), end);
    // Never across a removed region.
    w = w.slice(w.lastIndexOf(BREAK) + 1);
    // Clause and sentence boundaries. A full stop after a capital letter or a
    // known abbreviation ("E. coli", "et al.", "Fig.") is not a boundary.
    let cut = -1;
    const re = /([\p{L}\p{N})\]"”’%]+)([.!?;]|:)\s+/gu;
    let m;
    while ((m = re.exec(w))) {
        const word = m[1];
        if (m[2] === '.' && (/^\p{Lu}$/u.test(word) || /^(?:al|Fig|Figs|e\.g|i\.e|vs|cf|approx|ref|refs|Ref|Eq|Eqs|no|No|Dr|Prof|St|sp|spp|var|ca|Inc|Ltd|Co|Corp|vol|Vol|pp)$/.test(word))) continue;
        cut = m.index + m[0].length;
    }
    if (cut >= 0) w = w.slice(cut);
    // Inside an enclosing bracket, stop at its opening.
    let depth = 0;
    for (let i = w.length - 1; i >= 0; i--) {
        const c = w[i];
        if (c === ')' || c === ']') depth++;
        else if (c === '(' || c === '[') {
            if (depth === 0) return w.slice(i + 1);
            depth--;
        }
    }
    return w;
}

/** Bracket groups with their contents, innermost included; nesting tracked. */
function bracketGroups(text) {
    const groups = [], stack = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[') stack.push(i);
        else if (c === ')' || c === ']') {
            if (!stack.length) continue;
            const open = stack.pop();
            if (i - open - 1 <= 220) groups.push({ open, close: i, content: text.slice(open + 1, i) });
        } else if (c === BREAK || c === '\n' && stack.length > 3) stack.length = 0;
    }
    return groups.sort((a, b) => a.open - b.open);
}

/** Bracket content without a lead-in ("i.e.", "hereafter"), split at ";" and ", ". */
function splitBracketContent(content) {
    const c = content.replace(/\s+/g, ' ').trim().replace(LEAD_IN, '');
    const parts = c.split(/\s*;\s*|,\s+/).map(s => s.trim()).filter(Boolean);
    return { whole: c, parts };
}

// Brackets that give examples or point elsewhere define nothing: "(e.g., CD8, CD25)".
var NOT_A_DEFINITION = /^\s*(?:e\.?\s?g\.?|for\s+example|such\s+as|see|cf\.?|compare|including)[\s,:]/i;

/** Candidate definitions from brackets: forward, inside and reverse. */
function bracketCandidates(text, add) {
    for (const g of bracketGroups(text)) {
        if (NOT_A_DEFINITION.test(g.content)) continue;
        const { whole, parts } = splitBracketContent(g.content);
        if (!whole) continue;
        const first = parts[0], last = parts[parts.length - 1];
        // forward: long form (SF) / (SF, Fig. 1) / (MgAl2O4, PS) / (SF: ...)
        // "(SF: 20 mM Tris, ...)" gives the composition after the short form.
        const forward = new Set([whole, first, first.split(/:\s/)[0]]);
        if (parts.length > 1) forward.add(last);
        let window = null;
        for (const sf of forward) {
            if (!looksLikeShortForm(sf)) continue;
            if (window === null) window = windowBefore(text, g.open);
            add(sf, window, 'end', 'forward', g.open, whole);
        }
        // inside: (long form, SF)
        if (parts.length > 1 && looksLikeShortForm(last)) {
            const lf = parts.slice(0, -1).join(', ').replace(LEAD_IN, '');
            if (/\p{L}{3}/u.test(lf)) add(last, lf, 'both', 'inside', g.open);
        }
        // reverse: SF (long form)
        const before = text.slice(Math.max(0, g.open - 24), g.open);
        const tok = /(?:^|[\s(\[,;:])([\p{L}\p{N}][\p{L}\p{N}\-\u2010\u2011/.]*[\p{L}\p{N}])\s?$/u.exec(before);
        if (tok && looksLikeShortForm(tok[1]) && !looksLikeShortForm(whole) && /\p{L}{3}/u.test(whole)) {
            add(tok[1], whole, 'both', 'reverse', g.open);
            if (parts.length > 1 && first !== whole) add(tok[1], first, 'both', 'reverse', g.open);
        }
    }
}

/** "long form, hereafter SF", "... abbreviated as SF", "... termed SF", "..., or SF". */
function phraseCandidates(text, add) {
    PHRASE_LINK.lastIndex = 0;
    let m;
    while ((m = PHRASE_LINK.exec(text))) {
        const sf = m[1].replace(/\.$/, '');
        if (!looksLikeShortForm(sf)) continue;
        add(sf, windowBefore(text, m.index), 'end', 'phrase', m.index);
    }
}

/** Table and figure keys: "SF = long form" (", SF = ...", "SF = ...; "). */
function keyCandidates(text, add) {
    const re = /(?:^|[\s(;,.])([\p{L}\p{N}][\p{L}\p{N}\-\u2010\u2011/]{0,18}[\p{L}\p{N}])\s?=\s?(?=\p{L})/gu;
    let m;
    while ((m = re.exec(text))) {
        const sf = m[1];
        if (!looksLikeShortForm(sf)) continue;
        const from = m.index + m[0].length;
        let lf = text.slice(from, from + 160);
        const stop = lf.search(/[;\n\u2029]|\.\s|,\s?[\p{L}\p{N}][\p{L}\p{N}\-/]{0,18}\s?=|\s[\p{L}\p{N}][\p{L}\p{N}\-/]{0,18}\s=/u);
        if (stop >= 0) lf = lf.slice(0, stop);
        if (/\p{L}{3}/u.test(lf)) add(sf, lf, 'start', 'key', m.index);
    }
}

// ---- explicit abbreviation lists ----------------------------------------------------

// "Abbreviations:" anywhere, or an "Abbreviations" heading at the start of a line.
var LIST_HEADER = /(?:^|\n)[ \t]*(?:Table\s+\d+\s*[|.:]\s*)?(?:(?:the\s+)?list\s+of\s+abbreviations|(?:non-?standard\s+)?abbreviations?(?:\s+and\s+(?:acronyms|symbols))?(?:\s+used)?)[ \t]*[:.\-\u2013\u2014]?[ \t]*(?=\S)|\b(?:abbreviations?|abbreviation\s+key)(?:\s+used(?:\s+in\s+this\s+(?:paper|study|article|work))?(?:\s+are)?)?[ \t]*:[ \t]*/gi;
var LIST_END = /\n[ \t]*\n|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2029]|\u00a9|www\.|https?:\/\/|\b(?:METHODS|RESULTS|INTRODUCTION|DISCUSSION|References|Declarations|Supplementary\s+Information)\b/;

function splitAbbreviationEntries(block) {
    // Journals use several layouts for an abbreviation list:
    //   "BA, bile acids; CHD, coronary heart disease"      (comma)
    //   "TE: Trolox equivalent; SNP: sodium nitroprusside"  (colon)
    //   "AAV adeno-associated virus, Ab Antibody"           (space)
    //   "circRNAs Circular RNAs\nRBPs RNA-binding proteins" (one per line)
    // Every layout is parsed and the one with the most entries wins. A list
    // is contiguous: reading stops where two chunks in a row are not entries,
    // or after an entry that runs on into prose (it is trimmed later).
    const text = String(block || '').trim();
    if (!text) return [];
    const clean = v => String(v || '').replace(/\s+/g, ' ').replace(/^[\s,;:.]+|[\s,;:.]+$/g, '').trim();
    const isEntry = (abbr, term) => looksLikeShortForm(abbr, true) && term.length >= 2 && /\p{L}{2}/u.test(term);
    const entry = (abbr, term) => isEntry(abbr, term) ? [{ abbr, term }] : [];
    // "SF, long form" or "SF: long form" (several colon entries may share a chunk).
    const delimited = chunk => {
        const ci = chunk.indexOf(':'), mi = chunk.indexOf(',');
        if (ci !== -1 && (mi === -1 || ci < mi)) {
            const re = /(?:^|\s)([\p{L}\p{N}Α-ω][\p{L}\p{N}\-\u2010-\u2015/.]{0,23})\s*:\s*/gu;
            const marks = [];
            let m;
            while ((m = re.exec(chunk))) marks.push({ abbr: m[1], start: m.index, end: re.lastIndex });
            return marks.flatMap((mk, i) =>
                entry(mk.abbr, clean(chunk.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : chunk.length))));
        }
        return mi === -1 ? [] : entry(chunk.slice(0, mi).trim(), clean(chunk.slice(mi + 1)));
    };
    // "SF long form"
    const spaced = chunk => {
        const c = chunk.replace(/\s+/g, ' ');
        const sp = c.indexOf(' ');
        if (sp < 1) return [];
        const term = clean(c.slice(sp + 1));
        return /\p{L}{3}/u.test(term) ? entry(c.slice(0, sp).replace(/[,:]$/, ''), term) : [];
    };
    const read = (separator, parse) => {
        const out = [];
        let misses = 0;
        for (const raw of text.split(separator)) {
            const chunk = raw.trim();
            if (!chunk) continue;
            const found = parse(chunk);
            if (found.length) {
                out.push(...found);
                misses = 0;
                if (chunk.length > 200) break;
            } else if (out.length && ++misses >= 2) break;
        }
        return out;
    };
    const layouts = [
        read(/;+/, delimited), read(/,\s*(?=[\p{Lu}\p{N}])/u, delimited),
        read(/,\s*(?=[\p{L}\p{N}])/u, spaced), read(/;+/, spaced), read(/\n+/, spaced)
    ];
    return layouts.reduce((best, l) => l.length > best.length ? l : best, []);
}

/** Bound a long form taken from a list, where it follows the short form. */
function trimListLongForm(abbr, term) {
    let t = String(term || '').replace(/\s+/g, ' ').trim();
    const sentence = t.search(/\.\s+[\p{Lu}“"(\[]/u);
    if (sentence > 0) t = t.slice(0, sentence);
    t = t.replace(/\s*\[\d+(?:\s*[,\u2013-]\s*\d+)*\]\s*$/, '').replace(/\s*\([^)]{8,}\)\s*$/, '').trim();
    // A run-on into body text: when the short form aligns with the start and
    // more than two words follow its last aligned word, cut there. One or two
    // ("... sulfonic acid", "... Triton X100") belong to the term.
    const aligned = alignLongForm(abbr, t, 'start');
    if (aligned && aligned.quality >= 1.5) {
        const words = t.split(/\s+/);
        if (words.length - (aligned.lastWord + 1) > 2) t = words.slice(0, aligned.lastWord + 1).join(' ');
    }
    const units = (String(abbr).match(/[\p{L}\p{N}]/gu) || []).length;
    const maxWords = Math.max(6, Math.min(units + 5, units * 2));
    const words = t.split(/\s+/);
    if (words.length > maxWords) t = words.slice(0, maxWords).join(' ');
    if (t.length > 120) t = t.slice(0, 120);
    return t.replace(/[\s,;:]+$/, '').replace(/\s+(?:and|or|of|the|a|an|to|in|for|with|all)$/i, '').trim();
}

/** Entries of explicit abbreviation lists ("Abbreviations: ..."). */
function listCandidates(text, add) {
    LIST_HEADER.lastIndex = 0;
    let m;
    while ((m = LIST_HEADER.exec(text))) {
        const rest = text.slice(LIST_HEADER.lastIndex, LIST_HEADER.lastIndex + 6000);
        const endAt = rest.search(LIST_END);
        const block = (endAt >= 0 ? rest.slice(0, endAt) : rest).replace(/\b\d{2,4}\s*$/, '');
        const entries = splitAbbreviationEntries(block);
        if (entries.length < 2) continue;       // a list has more than one entry
        for (const e of entries) {
            const lf = trimListLongForm(e.abbr, e.term);
            if (!lf) continue;
            // "but", "with", "who": prose read as a list. A lowercase short
            // form must align with its long form to count.
            if (!/[\p{Lu}\d]/u.test(e.abbr)) {
                const a = alignLongForm(e.abbr, lf, 'start');
                if (!a || a.quality < 1) continue;
            }
            add(e.abbr, lf, null, 'list', m.index);
        }
    }
}

// Runs of key entries under tables and in figure legends (inlineKeyCandidates).
var KEY_SF = '[\\p{L}\\p{N}][\\p{L}\\p{N}\\-\\u2010\\u2011/]{0,15}[\\p{L}\\p{N}]?';
var KEY_RUNS = [
    // "SF, long form; SF, long form"
    { re: new RegExp('(?:^|[.;:]\\s|\\n)((?:' + KEY_SF + ',\\s[^;,\\n]{3,80}?;\\s)+' + KEY_SF + ',\\s[^;\\n]{3,80}?)(?=[.;\\n]|$)', 'gu'),
      entries: /;\s/, link: ', ' },
    // "SF: long form, SF: long form" (or with ";")
    { re: new RegExp('(?:^|[.;(]\\s?|\\n)((?:' + KEY_SF + ':\\s[^;,:\\n]{3,80}?[;,]\\s)+' + KEY_SF + ':\\s[^;:\\n]{3,80}?)(?=[.;)\\n]|$)', 'gu'),
      entries: /[;,]\s(?=[\p{L}\p{N}][^\s:]{0,17}:\s)/u, link: ': ' }
];

/**
 * A run of key entries without a heading, as under tables and in figure
 * legends: "INS, insertions; DEL, deletions; CNV, copy-number variants" or
 * "Bsu: Bacillus subtilis, Mtu: Mycobacterium tuberculosis".
 */
function inlineKeyCandidates(text, add) {
    for (const { re, entries, link } of KEY_RUNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
            for (const entry of m[1].split(entries)) {
                const at = entry.indexOf(link);
                if (at < 1) continue;
                const sf = entry.slice(0, at).trim(), lf = entry.slice(at + link.length).trim();
                if (looksLikeShortForm(sf)) add(sf, lf, 'start', 'key', m.index);
            }
        }
    }
}

// ---- choosing and checking definitions -----------------------------------------------

// What each kind of evidence needs to be accepted: the minimum alignment
// quality (score per short-form unit; 3 = every unit at the start of a word),
// how many content words may contribute no letter, and how many words the
// long form needs. Measured on the dev set: a long form in which every word
// contributes a letter is right at almost any quality, including one-word
// chemical names (phosphoenolpyruvate PEP, dithiothreitol DTT); words that
// contribute nothing are where wrong spans come from. A reverse "SF (text)"
// is the weakest evidence, because prose often follows a term with a
// bracketed synonym or example, so it needs a near-perfect multi-word match.
// One more contributing-nothing word is allowed at 0.5 more quality
// ("Fragments Per Kilobase per Million mapped reads (FPKM)").
var ACCEPT = {
    forward: { quality: 1.0, unmatched: 1, words: 1 },
    phrase: { quality: 1.0, unmatched: 1, words: 1 },
    key: { quality: 1.0, unmatched: 1, words: 1 },
    inside: { quality: 1.0, unmatched: 2, words: 1 },
    reverse: { quality: 2.2, unmatched: 1, words: 2 }
};

/** Accept or reject one candidate; returns the long form to keep, or ''. */
function judgeCandidate(sf, text, mode, kind, known) {
    if (kind === 'list') return text;
    const a = alignLongForm(sf, text, mode);
    const rule = ACCEPT[kind];
    if (a && a.quality >= rule.quality + (a.unmatched > rule.unmatched ? 0.5 : 0) &&
        a.unmatched <= rule.unmatched + 1 && a.words >= rule.words &&
        !restatesShortForm(sf, a.longForm)) {
        // A dictionary meaning written out here that contains the aligned
        // span is the fuller reading: "half maximal inhibitory concentration
        // (IC50)", where the alignment alone finds "inhibitory concentration".
        const fuller = known ? knownMeaningInText(text, known(sf)) : '';
        return fuller.length > a.longForm.length && flatten(fuller).includes(flatten(a.longForm)) ? fuller : a.longForm;
    }
    // A dictionary meaning written out right there counts as alignment: the
    // dictionary normalises definitions the paper provides.
    return known ? knownMeaningInText(text, known(sf)) : '';
}

/**
 * Is the "long form" just the short form again, or another short form?
 * "bKLs (KLs)", "nPAGE (PAGE)", "FPKM ... GeneiFPKMmale", "MAP2Ks (MAP3Ks)":
 * one token of capitals and fragments, with no lowercase word in it.
 * A short form with one capital may legitimately start its long form
 * ("Ub", ubiquitin), so containment only counts from two capitals.
 */
function restatesShortForm(sf, lf) {
    const base = singularShortForm(sf) || sf;
    if ((base.match(/\p{Lu}/gu) || []).length >= 2 && lf.includes(base)) return true;
    return !/\s/.test(lf) && (lf.match(/\p{Lu}/gu) || []).length >= 2 && !/\p{Ll}{4}/u.test(lf);
}

/**
 * Shaped like an abbreviation, as needed to trust the phrase before it without
 * letter evidence: one token, at least two capitals, more letters than digits.
 * Positions and mutations ("A3", "6F"), names ("GeneCopoeia") and versions
 * are excluded.
 */
function isAbbreviationLike(sf) {
    const upper = (sf.match(/\p{Lu}/gu) || []).length;
    const letters = (sf.match(/\p{L}/gu) || []).length, digits = (sf.match(/\d/g) || []).length;
    return !/\s/.test(sf) && upper >= 2 && letters > digits && !/\p{Ll}{4}/u.test(sf);
}

// Words that end a noun phrase when reading backwards from a bracket.
var PHRASE_STOP = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'its', 'their', 'our',
    'his', 'her', 'which', 'who', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have',
    'had', 'called', 'termed', 'named', 'known', 'using', 'used', 'use', 'via', 'by', 'with', 'from',
    'into', 'onto', 'for', 'as', 'to', 'at', 'on', 'in', 'and', 'or', 'but', 'than', 'also', 'both',
    'between', 'such', 'including', 'include', 'includes', 'contains', 'containing', 'we', 'it', 'of',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);

/**
 * The noun phrase that ends a window of text: the words back to a
 * determiner, preposition, verb or punctuation, two to six of them.
 */
function phraseBefore(window) {
    const words = String(window).trim().split(/\s+/);
    const out = [];
    for (let i = words.length - 1; i >= 0 && out.length < 6; i--) {
        const w = words[i];
        if (/[,;:.)\]"”]$/.test(w) && out.length) break;
        const bare = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
        if (!bare || PHRASE_STOP.has(bare) || /^[\d.,]/.test(bare)) break;
        // A capitalised word after a lowercase one starts the name or sentence:
        // "...pool homeostasis Mitochondrial carrier family members (SLC25)".
        if (out.length && /^\p{Ll}/u.test(w) && /^\p{Lu}\p{Ll}/u.test(out[0])) break;
        out.unshift(w);
        if (/^["“‘(\[]/.test(w)) break;
    }
    const phrase = out.join(' ').replace(/^[\s"“‘'(\[]+|[\s"”’',;:]+$/g, '');
    // One word alone is too often a verb, a unit or a name ("calculated (Fluo/CBB)").
    return out.length >= 2 && /\p{L}{3}/u.test(phrase) ? phrase : '';
}

/** The first of `meanings` that the text ends (or starts) with, or ''. */
function knownMeaningInText(text, meanings) {
    if (!meanings.length) return '';
    const t = flatten(text);
    for (const m of meanings) {
        const f = flatten(m);
        if (f.length >= 4 && (t.endsWith(f) || t.startsWith(f))) return m;
    }
    return '';
}

// Notes added to a meaning that the paper does not confirm, so that where it
// comes from travels with it (tooltips, the copied list).
var NOTES = {
    probable: 'probable meaning: the words before the bracketed abbreviation',
    common: 'common term; not explicitly defined in this paper',
    commonSeveral: 'common possible meanings; not explicitly defined in this paper'
};

/**
 * Find abbreviation definitions in a paper's text.
 *
 * Each result says how certain it is: 'defined' (the paper defines it and
 * the letters confirm it), 'probable' (the words before the abbreviation's
 * first bracket), 'library' (defined in the user's other papers), 'common'
 * (the curated glossary) or 'user' (the user's own definition).
 *
 * @param {string} text  the extracted text of the PDF
 * @param {{staticDefs:Object, commonKnownDefs:Object, userDefs?:Object, ignore?:string[],
 *          library?:Object<string, Array<{term:string, papers:number}>>}} dicts
 * @returns {Array<{abbr:string, term:string, source:string, certainty:string}>} source is the kind
 *   of evidence ('forward', 'list', ..., 'probable', 'library', 'common-known' or 'user').
 */
function detectAbbreviations(text, dicts) {
    const staticDefs = dicts.staticDefs || {};
    const glossary = dicts.commonKnownDefs || {};
    const raw = String(text || '');
    const clean = cleanText(raw);
    const body = dropReferences(clean);
    // Every dictionary meaning of a short form (or of its singular).
    const known = sf => [sf, singularShortForm(sf) || sf]
        .flatMap(k => [staticDefs[k], ...(glossary[k] || []).map(o => o.term)]).filter(Boolean);

    // 1. Every candidate definition, scored where it stands.
    const accepted = new Map();     // key -> { abbr, term, source, rank, pos }
    const RANK = { list: 0, key: 1, forward: 2, inside: 2, phrase: 2, reverse: 3 };
    // Author initials keys ("PMGR, Pablo M Garcia-Roves") expand to names
    // that are in the author list at the top of the paper.
    const head = raw.slice(0, 4000);
    const isAuthor = lf => /^\p{Lu}[\p{L}'\u2019.-]*(?:\s\p{Lu}[\p{L}'\u2019.-]*){1,3}$/u.test(lf) && head.includes(lf);
    // Short forms the paper sets out to define, whether or not the definition
    // could be read. A reverse "SF (...)" does not count: most are not definitions.
    const attempted = new Set();
    const firstBracket = new Map();   // key -> { sf, window, pos } of its first "text (SF)"
    const add = (sf, lfText, mode, kind, pos, whole) => {
        sf = sf.trim();
        if (kind !== 'reverse') attempted.add(singularShortForm(sf) || sf);
        if (kind === 'forward' && whole === sf) {
            const k = singularShortForm(sf) || sf;
            if (!firstBracket.has(k) || firstBracket.get(k).pos > pos) firstBracket.set(k, { sf, window: lfText, pos });
        }
        const term = judgeCandidate(sf, lfText, mode, kind, known);
        if (!term || term.length > 160 || !/\p{L}{3}/u.test(term)) return;
        if (kind === 'key' && isAuthor(term)) return;
        if (term.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === sf.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()) return;
        const key = singularShortForm(sf) || sf;
        const prev = accepted.get(key);
        const rank = RANK[kind];
        if (prev && (prev.rank < rank || (prev.rank === rank && prev.pos <= pos))) return;
        accepted.set(key, { abbr: sf, term, source: kind, rank, pos });
    };
    listCandidates(clean, add);
    keyCandidates(body, add);
    inlineKeyCandidates(body, add);
    bracketCandidates(body, add);
    phraseCandidates(body, add);

    const counts = countTokens(body, t => !!(staticDefs[t] || glossary[t]), t => attempted.has(t));
    // Uses of a short form written on its own, and inside compounds.
    const countOf = sf => {
        if (/^[\p{L}\p{N}][\p{L}\p{N}\-\u2010\u2011/.']*$/u.test(sf)) return counts.alone.get(sf) || 0;
        const re = new RegExp('(?:^|[^\\p{L}\\p{N}])' + escapeRegExp(sf) + '(?=$|[^\\p{L}\\p{N}])', 'gu');
        return (body.match(re) || []).length;
    };
    const compoundUses = sf => counts.inCompounds.get(sf) || 0;
    const forms = sf => [sf, singularShortForm(sf) || sf, ...pluralShortForms(sf)];

    // 2. A short form the paper puts in brackets on first use, without a
    //    definition the letters confirm: the phrase before the bracket is
    //    probably its meaning ("a cytoprotective transcription factor (ATF4)").
    //    Not where a curated meaning holds in every field.
    for (const [k, b] of firstBracket) {
        if (accepted.has(k) || !isAbbreviationLike(b.sf) || (glossary[k] || []).some(o => o.ambiguity === 'low')) continue;
        const first = body.search(new RegExp('(?:^|[^\\p{L}\\p{N}])' + escapeRegExp(b.sf) + '(?=$|[^\\p{L}\\p{N}])', 'u'));
        if (first >= 0 && first < b.pos - b.sf.length - 2) continue;      // used before: not where it is introduced
        if (countOf(b.sf) + forms(b.sf).slice(2).reduce((n, f) => n + countOf(f), 0) < 2) continue;
        const phrase = phraseBefore(b.window);
        if (!phrase || restatesShortForm(b.sf, phrase)) continue;
        accepted.set(k, { abbr: b.sf, term: phrase, source: 'probable', rank: 4, pos: b.pos });
    }

    const pairs = [...accepted.values()]
        .sort((a, b) => a.pos - b.pos)
        .map(p => p.source === 'probable'
            ? { abbr: p.abbr, term: p.term + ' (' + NOTES.probable + ')', source: 'probable', certainty: 'probable' }
            : { abbr: p.abbr, term: p.term, source: p.source, certainty: 'defined' });

    // Short forms the paper uses at least twice without defining them get a
    // meaning from the user's other papers, else from the glossary. A
    // definition the paper gives always wins. Where the paper sets out to
    // define a short form in words that could not be read, a meaning from
    // elsewhere is given only if the paper also writes it out.
    const lowerBody = body.toLowerCase();
    const flatBody = flatten(body);
    const taken = new Set(accepted.keys());
    const isTaken = sf => forms(sf).some(f => taken.has(f));
    const usedTwice = sf => [...new Set(forms(sf))].reduce((n, f) => n + countOf(f), 0) + compoundUses(sf) >= 2;
    const selfDefinedHere = sf => forms(sf).some(f => attempted.has(f));
    const writtenOut = term => flatBody.includes(flatten(term));
    const aboutThisPaper = term => (term.toLowerCase().match(/\p{L}{4,}/gu) || [])
        .every(w => lowerBody.includes(w.replace(/(?:es|s)$/, '')));

    // 3. Definitions from the user's other papers (dicts.library: short form
    //    -> [{ term, papers }]), the meanings used in the user's own field.
    for (let [abbr, options] of Object.entries(dicts.library || {})) {
        if (!options || !options.length || isTaken(abbr) || !usedTwice(abbr)) continue;
        // Where the glossary knows the short form, the library only chooses
        // among the glossary's meanings (the one the user's field uses); a
        // meaning the glossary does not list is not trusted over it.
        const curated = (glossary[abbr] || []).map(o => o.term);
        if (curated.length) options = options.filter(o => curated.some(t => sameMeaning(t, o.term)))
            .map(o => ({ term: curated.find(t => sameMeaning(t, o.term)), papers: o.papers }));
        // The meaning must belong to this paper's subject: every content word
        // of it occurs somewhere in the paper ("Golgi apparatus" for GA only
        // in a paper that mentions the Golgi).
        const usable = options.filter(o => (!selfDefinedHere(abbr) || writtenOut(o.term)) && aboutThisPaper(o.term))
            .sort((a, b) => b.papers - a.papers);
        if (!usable.length) continue;
        // Meanings seen in about as many papers as the most common one are all shown.
        const shown = usable.filter(o => o.papers * 2 >= usable[0].papers).slice(0, 3);
        const papers = shown.reduce((n, o) => n + o.papers, 0);
        taken.add(abbr);
        pairs.push({
            abbr,
            term: shown.map(o => o.term).join(' / ') + ' (' + (shown.length > 1 ? 'possible meanings ' : '') +
                'from ' + (papers === 1 ? 'another paper' : papers + ' other papers') + ' in your library)',
            source: 'library',
            certainty: 'library'
        });
    }

    // 4. The curated glossary of well-known abbreviations. How far it may go
    //    depends on how ambiguous the entry is.
    for (const [abbr, options] of Object.entries(glossary)) {
        if (!options || !options.length || isTaken(abbr) || !usedTwice(abbr)) continue;
        const selfDefined = selfDefinedHere(abbr);
        const terms = [];
        for (const opt of options) {
            if (opt.ambiguity === 'low') {
                if (!terms.includes(opt.term)) terms.push(opt.term);
                continue;
            }
            // A meaning that depends on the field needs the field's words in
            // the paper, and is never given where the paper defines the short
            // form itself, unless the paper also writes that meaning out.
            if (!hasContextSupport(opt, lowerBody)) continue;
            if (selfDefined && !writtenOut(opt.term)) continue;
            if (!terms.includes(opt.term)) terms.push(opt.term);
        }
        if (!terms.length) continue;
        taken.add(abbr);   // so the plural entry of the glossary is not added as well
        pairs.push({
            abbr,
            term: terms.join(' / ') + ' (' + (terms.length > 1 ? NOTES.commonSeveral : NOTES.common) + ')',
            source: 'common-known',
            certainty: 'common'
        });
    }

    // 5. The user's own definitions win, for short forms the paper uses. A
    //    definition of "EV" also covers a paper that writes "EVs".
    const sameShortForm = (a, b) => (singularShortForm(a) || a) === (singularShortForm(b) || b);
    for (const [abbr, term] of Object.entries(dicts.userDefs || {})) {
        if (!abbr || !term || !forms(abbr).some(countOf)) continue;
        const existing = pairs.find(p => sameShortForm(p.abbr, abbr));
        if (existing) Object.assign(existing, { term, source: 'user', certainty: 'user' });
        else pairs.push({ abbr, term, source: 'user', certainty: 'user' });
    }
    // Ignoring a short form ignores its singular and plural too.
    const ignored = dicts.ignore || [];
    return ignored.length ? pairs.filter(p => !ignored.some(i => sameShortForm(i, p.abbr))) : pairs;
}

/** Does the paper talk about the subject a glossary meaning belongs to? */
function hasContextSupport(option, lowerBody) {
    const ctx = option.context || [];
    if (!ctx.length) return option.ambiguity === 'low';
    for (const c of ctx) if (lowerBody.includes(String(c).toLowerCase())) return true;
    return false;
}

/** Two spellings of one meaning: case, hyphens, spaces and a plural -s aside. */
function sameMeaning(a, b) { return flatten(a).replace(/s$/, '') === flatten(b).replace(/s$/, ''); }

/** Lowercase letters and digits only, for comparing spellings. */
function flatten(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ============================================================================
 * Where a word is used
 *
 * For tooltip 3, "where a word is used": the first uses of a word in a
 * paper, with their pages and the words around them. Most useful for an
 * abbreviation the detector could not explain: its first use usually holds
 * the definition, in whatever words the authors chose.
 * ============================================================================ */

/**
 * The text of each page (index 0 is the PDF's first page), cleaned as for
 * detection: running headers and footers removed, all whitespace single
 * spaces. A word broken over two lines keeps its hyphen.
 */
function pageTexts(text) {
    const lines = fixCharacters(text).split('\n');
    const headers = runningHeaderLines(lines);
    // A header line goes, but its page breaks stay, so page numbers hold.
    return lines.map((l, i) => headers.has(i) ? l.replace(/[^\f]/g, '') : l).join('\n')
        .split('\f')
        .map(page => page.replace(/-\n(?=\p{Ll})/gu, '-').replace(/\s+/g, ' ').trim());
}

/**
 * The words around a match: back to the start of its sentence and on to its
 * end, but at most `count` words each way, with "…" where more was cut.
 */
function wordsAround(page, start, end, count) {
    let before = page.slice(Math.max(0, start - 800), start);
    let after = page.slice(end, end + 800);
    // A sentence ends at . ! or ? followed by a capital, a digit or a bracket,
    // which may be the use itself: one that starts a sentence has no words
    // before it.
    const starts = [...(before + page.charAt(start)).matchAll(/[.!?]\s+(?=[\p{Lu}\d(\[])/gu)];
    const sentenceStart = starts.length > 0;
    if (sentenceStart) {
        const last = starts[starts.length - 1];
        before = before.slice(last.index + last[0].length);
    }
    const stop = /[.!?](?=\s+[\p{Lu}\d(\[]|$)/u.exec(after);
    if (stop) after = after.slice(0, stop.index + 1);
    const bw = before.match(/\S+\s*/g) || [];
    const aw = after.match(/\s*\S+/g) || [];
    const cutBefore = bw.length > count || (!sentenceStart && start > before.length);
    const cutAfter = aw.length > count || (!stop && end + after.length < page.length);
    return {
        before: (cutBefore ? '…' : '') + bw.slice(-count).join('').replace(/^\s+/, ''),
        after: aw.slice(0, count).join('').replace(/\s+$/, '') + (cutAfter ? '…' : '')
    };
}

/**
 * A pattern for a word as a whole word, in its singular and plural forms and
 * with any kind of dash, or null for no word.
 */
function usesPattern(word) {
    const w = String(word || '').trim();
    if (!w) return null;
    // Longest form first, so "EVs" is not found as "EV" followed by "s".
    const forms = [...new Set([w, singularShortForm(w) || w, ...pluralShortForms(w)])]
        .sort((a, b) => b.length - a.length)
        .map(f => escapeRegExp(f).replace(/[-‐‑–—]/g, '[-‐‑–—]'));
    return new RegExp('(?<![\\p{L}\\p{N}])(?:' + forms.join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
}

/**
 * Where a word is used: how often, and its first `limit` uses, each with its
 * page (0-based), which use of the word on that page it is, the form found
 * and the words around it. The singular and plural count ("EV", "EVs"), and
 * so do uses inside compounds ("EV-derived"); case matters.
 *
 * @returns {{ total: number, uses: Array<{pageIndex: number, nthOnPage: number,
 *            match: string, before: string, after: string}> }}
 */
function findUses(text, word, limit, contextWords) {
    const re = usesPattern(word);
    if (!re) return { total: 0, uses: [] };
    const uses = [];
    let total = 0;
    pageTexts(text).forEach((page, pageIndex) => {
        let m, nth = 0;
        re.lastIndex = 0;
        while ((m = re.exec(page))) {
            total++;
            if (uses.length < limit) {
                const around = wordsAround(page, m.index, m.index + m[0].length, contextWords || 15);
                uses.push({ pageIndex, nthOnPage: nth, match: m[0], before: around.before, after: around.after });
            }
            nth++;
        }
    });
    return { total, uses };
}

// Everything stateful lives on this one object. bootstrap.js loads this file
// into the plugin's own scope, and the Settings pane reaches the object
// through Zotero.AbbreviationHelper (see init).
var AbbreviationHelper = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],
    // Detected pairs per attachment item id. Bounded so a long session with
    // many PDFs cannot grow memory without limit; oldest entries are evicted.
    cache: new Map(),
    CACHE_LIMIT: 50,
    // Abbreviation dictionaries, loaded from the bundled data/abbreviations.json
    // plus an optional user-editable copy in the Zotero data directory.
    dictionaries: null,
    _dictionariesReady: null,
    // Settings, mirrored from preferences by _loadPrefs (defaults in prefs.js).
    // Three tooltips, each switched on or off and shown with its own key
    // ('none': no key, while pointing). Only meanings are on at first, shown
    // without a key; database links ask for Shift once switched on, so
    // ordinary reading stays uncluttered. Tooltips sharing a key show as one.
    hoverEnabled: true,
    tooltipModifier: 'none',
    databaseLinksModifier: 'shift',
    modifierState: { shift: false, ctrl: false, alt: false, meta: false },
    tooltipFontSize: 12,
    tooltipTheme: 'dark',
    // The line under a meaning saying where it comes from ("Defined in this
    // paper", "Common term; ..."). Switching it off leaves the meaning alone.
    showMeaningSource: true,
    // "Where a word is used": while this modifier is held over any word, the
    // tooltip lists the word's first uses in the paper. Never 'none': a list
    // under every word pointed at would bury the page. Ctrl also means Cmd.
    usesEnabled: false,
    usesModifier: 'ctrl',
    usesCount: 3,          // how many uses the list shows
    // Whether a tooltip for a defined abbreviation also carries database links.
    databaseLinksOnAbbreviations: true,
    // Master switch for the whole database-link layer. When false, no lookup
    // links are offered at all. Unchecking every database individually has
    // the same effect, but this is the switch people look for. Off for a new
    // install; kept on for those updating from 2.1.0 (see _keepOlderDefaults).
    databaseLinksEnabled: false,
    // Fill in abbreviations a paper uses without defining them with the
    // meanings the user's other papers define (see the library section).
    useLibraryDefinitions: true,
    lastHoverState: null,
    hoverDocs: [],
    // Main windows that follow the modifier keys too (see _followKeysIn).
    keyWindows: [],
    autoScanTimer: null,
    autoScanFirstRun: null,
    autoScanInProgress: false,
    activeHoverMap: new Map(),
    activeHoverItemID: null,
    hoverHideTimer: null,
    hoverPinnedDoc: null,
    // Whether the open tooltip has choices (database links, uses). Such a
    // tooltip holds still while the pointer travels from the word to it,
    // and can be clicked; one with only a meaning follows the pointer and
    // lets clicks through to the page.
    hoverInteractiveTooltip: false,
    // Whether the pointer is on the tooltip itself; it then stays as it is
    // when a modifier key goes up or down (see _onModifierKey).
    _pointerOnTooltip: false,
    // What each numbered choice of the open tooltip does (see _addChoices).
    activeChoices: [],
    // Extracted text per attachment, so a change to your definitions or the
    // ignore list can be re-detected without reading the PDF again. Texts are
    // large, so only a few are kept.
    textCache: new Map(),
    TEXT_CACHE_LIMIT: 5,
    // Set when the plugin shuts down. Work that was already under way (a scan
    // waiting for Zotero's PDF worker, say) checks it before touching the
    // reader, so a disabled or updated plugin leaves nothing behind.
    _stopped: false,
    // The last abbreviation whose meaning was shown; "Ignore an
    // Abbreviation…" offers it as the default.
    lastHoveredToken: '',
    // Why the abbreviations file could not be read, or null when it is fine.
    // While it is set, nothing writes to the file.
    userFileError: null,
    // How long the pointer may spend heading for a tooltip with links before
    // the tooltip goes back to following the word under the pointer.
    CORRIDOR_MS: 350,

    /**
     * Initialise the plugin.  Stores metadata and ensures we only
     * initialise once.
     */
    init({ id, version, rootURI }) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        // Marks the tooltip elements this copy of the plugin creates, so a
        // tooltip left in a reader page by an earlier version is replaced
        // rather than reused (see _ensureHoverTooltip).
        this._instanceToken = 'ah-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        // Restore saved user preferences (hover mode, Shift behavior, enabled
        // database groups) so they persist across Zotero restarts.
        this._loadPrefs();
        this._settleUsesKey();
        // Seed with a small built-in fallback so the plugin still works if the
        // bundled JSON cannot be read, then load the full and user dictionaries
        // asynchronously. Scans await _dictionariesReady before detecting.
        // An older version's defaults are settled first: that looks for the
        // abbreviations file before loading creates it.
        this.dictionaries = this._embeddedFallbackDictionaries();
        this._dictionariesReady = this._keepOlderDefaults()
            .catch(e => this.log('Could not check for an older version: ' + e))
            .then(() => this._loadDictionaries()).catch(e => {
            this.log('Dictionary load failed; using built-in fallback: ' + e);
            return this.dictionaries;
        });
        this._libraryReady = this._loadLibrary();
        // The preference pane runs in the Settings window, a separate document
        // with no reference to this scope. Zotero is the one object both can
        // see, so the pane reaches the plugin through it.
        try { Zotero.AbbreviationHelper = this; } catch (e) {}
        this._watchPrefs();
        this.initialized = true;
    },

    /* ---- Preference pane (Zotero 7+) ------------------------------------ */
    /**
     * Register the pane in Zotero's Settings window. Optional: if the API is
     * missing or registration fails, the plugin carries on and the Tools menu
     * remains the way to change settings.
     */
    registerPreferencePane() {
        try {
            if (!Zotero.PreferencePanes || !Zotero.PreferencePanes.register) {
                this.log('PreferencePanes API unavailable; using the Tools menu only');
                return null;
            }
            // Note the filenames: `prefs.js` in the plugin root is reserved by
            // Zotero for default preferences and is parsed as pref() calls, so
            // the pane's own script must not be called that.
            this._prefPaneID = Zotero.PreferencePanes.register({
                pluginID: this.id,
                src: 'settings.xhtml',
                scripts: ['settings.js'],
                stylesheets: ['settings.css'],
                label: 'Abbreviation Helper'
            });
            return this._prefPaneID;
        } catch (e) {
            this.log('Could not register the preference pane: ' + e);
            return null;
        }
    },

    unregisterPreferencePane() {
        try {
            if (this._prefPaneID && Zotero.PreferencePanes && Zotero.PreferencePanes.unregister) {
                Zotero.PreferencePanes.unregister(this._prefPaneID);
            }
        } catch (e) {
            this.log('Could not unregister the preference pane: ' + e);
        }
        this._prefPaneID = null;
    },

    /**
     * Watch the preference branch so changes made in the Settings window take
     * effect immediately. Without this the pane would write a preference that
     * the running plugin only notices at the next restart.
     */
    _watchPrefs() {
        if (this._prefObserver) return;
        try {
            if (typeof Services === 'undefined' || !Services.prefs) return;
            const branch = Services.prefs.getBranch(this.PREF_BRANCH);
            const self = this;
            this._prefObserver = {
                observe(subject, topic, data) {
                    if (topic !== 'nsPref:changed' || self._stopped) return;
                    try {
                        const libraryWas = self.useLibraryDefinitions;
                        self._loadPrefs();
                        // Meanings change for every paper.
                        if (self.useLibraryDefinitions !== libraryWas) self._redetect();
                        self._resetHoverTooltips();
                        if (!self._anyTooltipOn()) {
                            self._removeHoverListeners();
                            return;
                        }
                        self._refreshHoverFromLastState(null);
                        // A tooltip may just have been switched on in Settings.
                        self._autoScanActiveReader().catch(e => self.log('Auto-scan failed: ' + e));
                    } catch (e) {
                        self.log('Applying a changed preference failed: ' + e);
                    }
                }
            };
            branch.addObserver('', this._prefObserver, false);
            this._prefBranch = branch;
        } catch (e) {
            this.log('Could not observe preferences: ' + e);
        }
    },

    _unwatchPrefs() {
        try {
            if (this._prefBranch && this._prefObserver) {
                this._prefBranch.removeObserver('', this._prefObserver);
            }
        } catch (e) {}
        this._prefBranch = null;
        this._prefObserver = null;
    },

    /* ---- Preferences ------------------------------------------------------
     * Stored under extensions.abbreviation-helper.* through Zotero.Prefs, so
     * they survive restarts. Read at startup and whenever one changes (see
     * _watchPrefs); written by the Tools menu and the Settings pane. */
    PREF_BRANCH: 'extensions.abbreviation-helper.',

    _getPref(name, fallback) {
        try {
            const val = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
            return (val === undefined || val === null) ? fallback : val;
        } catch (e) {
            return fallback;
        }
    },

    _setPref(name, value) {
        try {
            Zotero.Prefs.set(this.PREF_BRANCH + name, value, true);
        } catch (e) {
            this.log('Could not save preference ' + name + ': ' + e);
        }
    },

    _loadPrefs() {
        // A value no version of the plugin writes (a hand-edited preference)
        // falls back to the default rather than hiding a tooltip for good.
        const oneOf = (name, allowed, fallback) => {
            const value = this._getPref(name, fallback);
            return allowed.includes(value) ? value : fallback;
        };
        this.hoverEnabled = this._getPref('hoverEnabled', this.hoverEnabled);
        this.tooltipModifier = oneOf('tooltipModifier', this.MODIFIERS, 'none');
        this.databaseLinksModifier = oneOf('databaseLinksModifier', this.MODIFIERS, 'shift');
        this.databaseLinksOnAbbreviations = this._getPref('databaseLinksOnAbbreviations', this.databaseLinksOnAbbreviations);
        this.databaseLinksEnabled = this._getPref('databaseLinksEnabled', this.databaseLinksEnabled);
        this.useLibraryDefinitions = this._getPref('useLibraryDefinitions', this.useLibraryDefinitions);
        this.showMeaningSource = this._getPref('showMeaningSource', this.showMeaningSource);
        this.usesEnabled = this._getPref('usesEnabled', this.usesEnabled);
        this.usesModifier = oneOf('usesModifier', this.MODIFIERS.filter(m => m !== 'none'), 'ctrl');
        this.usesCount = Number(this._getPref('usesCount', this.usesCount)) || 3;
        // A menulist in the preference pane stores its value as a string,
        // while the menu's radio items store a number. Coerce so both routes
        // to the same setting produce the same type.
        this.tooltipFontSize = Number(this._getPref('tooltipFontSize', this.tooltipFontSize)) || 12;
        this.tooltipTheme = oneOf('tooltipTheme', ['dark', 'light'], 'dark');
    },

    // What can show a tooltip, as the settings store it: no key, or a key held.
    MODIFIERS: ['none', 'shift', 'ctrl', 'alt'],

    /**
     * Keep "where a word is used" off a key another tooltip already uses.
     * Version 2.1.0 offered Ctrl for meanings and database links, and Ctrl is
     * also this tooltip's default: once switched on, holding Ctrl would add
     * the uses to what that key showed before the update. Until you pick
     * this key yourself, it moves to the first free one, saved so the
     * settings show it. A key you picked is kept: sharing a key is how the
     * tooltips are shown together. Run at startup only, so the key never
     * changes under an open Settings window.
     */
    _settleUsesKey() {
        if (this._prefIsSet('usesModifier')) return;
        const taken = [this.tooltipModifier, this.databaseLinksModifier];
        if (!taken.includes(this.usesModifier)) return;
        // Shift before Alt: on Windows, letting go of Alt alone opens the menu bar.
        const free = ['ctrl', 'shift', 'alt'].find(key => !taken.includes(key));
        this.usesModifier = free;
        this._setPref('usesModifier', free);
    },

    /** Has this setting been changed from its default (and saved)? */
    _prefIsSet(name) {
        try { return Services.prefs.prefHasUserValue(this.PREF_BRANCH + name); }
        catch (e) { return this._getPref(name, null) !== null; }
    },

    /**
     * Database links were on by default up to 2.1.0; from 2.2.0 only
     * meanings are. Someone updating keeps the links they had: the first
     * time this version runs, if the abbreviations file an older version
     * made on its first run is there, links never switched off are saved as
     * on. A new install has no such file and starts with the new defaults.
     * The version that ran last is recorded, so this happens only once.
     */
    async _keepOlderDefaults() {
        const last = this._getPref('lastVersion', '');
        if (!last && !this._prefIsSet('databaseLinksEnabled')) {
            const file = this._userDictionaryPath();
            if (file && await (await this._getIOUtils()).exists(file)) {
                this.databaseLinksEnabled = true;
                this._setPref('databaseLinksEnabled', true);
            }
        }
        // Recorded only once that check has run: if it failed, it runs again
        // at the next start.
        const now = String(this.version || '');
        if (now && last !== now) this._setPref('lastVersion', now);
    },

    /* ---- Dictionaries: bundled defaults + user-editable overrides ------- */

    /**
     * Minimal general-purpose fallback used only if both the bundled JSON and
     * the user dictionary fail to load. Locally defined abbreviations are still
     * detected without any dictionary; this only preserves a few very common
     * glossary lookups so hover never comes up completely empty.
     */
    _embeddedFallbackDictionaries() {
        return {
            userDefs: {},
            ignore: [],
            databases: [],
            staticDefs: {},
            commonKnownDefs: {
                'DNA': [{ term: 'deoxyribonucleic acid', ambiguity: 'low' }],
                'RNA': [{ term: 'ribonucleic acid', ambiguity: 'low' }],
                'PCR': [{ term: 'polymerase chain reaction', ambiguity: 'low' }],
                'ELISA': [{ term: 'enzyme-linked immunosorbent assay', ambiguity: 'low' }],
                'PBS': [{ term: 'phosphate buffered saline', ambiguity: 'low' }],
                'DMSO': [{ term: 'dimethyl sulfoxide', ambiguity: 'low' }],
                'BSA': [{ term: 'bovine serum albumin', ambiguity: 'low' }],
                'FBS': [{ term: 'fetal bovine serum', ambiguity: 'low' }]
            }
        };
    },

    /** Coerce arbitrary parsed JSON into the { staticDefs, commonKnownDefs } shape. */
    _normaliseDictionaries(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        return {
            staticDefs: obj(raw.staticDefs),
            commonKnownDefs: obj(raw.commonKnownDefs),
            // Your own definitions. Unlike staticDefs these are authoritative:
            // they are shown even when the paper defines the term differently.
            userDefs: obj(raw.userDefs),
            // Abbreviations to never display, for suppressing false positives.
            ignore: Array.isArray(raw.ignore) ? raw.ignore.filter(Boolean).map(String) : [],
            // Database lookup links.
            databases: Array.isArray(raw.databases) ? raw.databases.filter(d => d && d.label && d.url) : []
        };
    },

    /** Shallow-merge two dictionaries; entries in `extra` win. */
    _mergeDictionaries(base, extra) {
        base = base || {}; extra = extra || {};
        // A user-supplied database list replaces the defaults outright, so
        // entries can be removed and not just added to.
        const databases = (extra.databases && extra.databases.length)
            ? extra.databases : (base.databases || []);
        return {
            staticDefs: Object.assign({}, base.staticDefs, extra.staticDefs),
            commonKnownDefs: Object.assign({}, base.commonKnownDefs, extra.commonKnownDefs),
            userDefs: Object.assign({}, base.userDefs, extra.userDefs),
            ignore: [].concat(base.ignore || [], extra.ignore || []),
            databases
        };
    },

    /**
     * Load the bundled dictionary, then merge an optional user-editable copy
     * from the Zotero data directory over it. Never throws: any failure falls
     * back to whatever has loaded so far.
     */
    async _loadDictionaries() {
        let dicts = this._embeddedFallbackDictionaries();

        // 1) Bundled defaults shipped inside the plugin.
        try {
            const resp = await fetch(this.rootURI + 'data/abbreviations.json');
            if (resp && resp.ok) {
                const bundled = this._normaliseDictionaries(await resp.json());
                if (bundled) dicts = bundled;
            }
        } catch (e) {
            this.log('Could not read bundled dictionary: ' + e);
        }

        // 2) Optional user-editable override in the Zotero data directory. It is
        //    created on first run; its entries extend/override the defaults.
        try {
            const userDicts = await this._loadOrCreateUserDictionary();
            if (userDicts) dicts = this._mergeDictionaries(dicts, userDicts);
        } catch (e) {
            this.log('Could not read user dictionary: ' + e);
        }

        this.dictionaries = dicts;
        // Drop any results cached before the full dictionary was ready.
        try { this.cache.clear(); } catch (e) {}
        this.log('Dictionaries ready: ' + Object.keys(dicts.staticDefs).length +
            ' static, ' + Object.keys(dicts.commonKnownDefs).length + ' glossary entries.');
        return dicts;
    },

    /** IOUtils, preferring the runtime global and falling back to the module. */
    async _getIOUtils() {
        if (typeof IOUtils !== 'undefined') return IOUtils;
        const mod = await ChromeUtils.importESModule('resource://gre/modules/IOUtils.sys.mjs');
        return mod.IOUtils;
    },

    /** Join path segments using the separator implied by the base path. */
    _joinPath(base, ...parts) {
        const sep = base && base.indexOf('\\') !== -1 ? '\\' : '/';
        let out = String(base).replace(/[\\\/]+$/, '');
        for (const p of parts) out += sep + p;
        return out;
    },

    /**
     * Read the user dictionary at <dataDir>/abbreviation-helper/abbreviations.json,
     * creating an empty starter file on first run. Returns parsed dictionaries
     * or null. Throws (after recording userFileError) if the file exists but
     * cannot be read, so the caller falls back to the bundled defaults.
     */
    async _loadOrCreateUserDictionary() {
        const file = this._userDictionaryPath();
        if (!file) return null;
        const io = await this._getIOUtils();

        if (await io.exists(file)) {
            return this._normaliseDictionaries(this._parseUserConfig(await io.readUTF8(file)));
        }

        // First run: create the empty, editable starter file.
        this.userFileError = null;
        await this._ensureUserDictionaryFile();
        return null;
    },

    /**
     * Parse the text of the abbreviations file. If it is not a JSON object,
     * the reason is kept in userFileError (shown in Settings) and this throws,
     * so nothing ever writes over a file it could not read. An empty file
     * holds nothing to lose and counts as an empty object.
     */
    _parseUserConfig(text) {
        if (!String(text || '').trim()) {
            this.userFileError = null;
            return {};
        }
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (e) {
            const why = String((e && e.message) || e);
            this.userFileError = 'It is not valid JSON (' + why + '). Comments are not allowed in JSON.';
            throw new Error('Abbreviations file is not valid JSON: ' + why);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            this.userFileError = 'It must contain a JSON object, starting with { and ending with }.';
            throw new Error('Abbreviations file does not contain a JSON object');
        }
        this.userFileError = null;
        return raw;
    },

    /** One sentence saying why a change was not saved, for alerts and the Settings pane. */
    _saveFailedMessage() {
        if (this.userFileError) {
            return 'Nothing was saved, because your abbreviations file could not be read. '
                + this.userFileError + ' Open the file, correct it, then reload it.';
        }
        return 'Could not save the change. See the Zotero log for details.';
    },

    /**
     * The file created on first run. Deliberately EMPTY rather than a copy of
     * the bundled dictionary: a copy would bury the user's own entries and
     * would permanently shadow later improvements to the shipped defaults.
     */
    _starterUserConfig() {
        return {
            _comment: [
                'Your Abbreviation Helper settings. Most of this can be edited in',
                'Zotero Settings -> Abbreviation Helper. If you edit here instead,',
                'save the file and then use Reload from file in that pane.',
                'userDefs:   "ABC": "your meaning"  - always shown, wins over the paper.',
                'ignore:     ["NEB"]                - never show these.',
                'databases:  [{"group":"Gene/protein databases","label":"UniProt",',
                '             "url":"https://www.uniprot.org/uniprotkb?query={q}","enabled":true}]',
                '            {q} = token without hyphens, {raw} = token as written.',
                '            A non-empty list here REPLACES the built-in databases.'
            ].join(' '),
            userDefs: {},
            ignore: [],
            databases: []
        };
    },

    /**
     * Change the abbreviations file. `mutate` receives what is on disk now
     * (with any missing section filled in) and edits it in place; returning
     * false means there is nothing to change, and the file is not written.
     *
     * Every edit starts from the file rather than from memory, and edits run
     * one at a time, so two changes made in quick succession both survive. A
     * file that cannot be parsed is never written: the promise rejects and the
     * file stays exactly as it was. Resolves false if there is no Zotero data
     * directory, true once the change is saved.
     */
    _editUserConfig(mutate) {
        const run = async () => {
            const file = await this._ensureUserDictionaryFile();
            if (!file) return false;
            const io = await this._getIOUtils();
            const current = Object.assign(this._starterUserConfig(),
                this._parseUserConfig(await io.readUTF8(file)));
            if (mutate(current) === false) return false;
            await this._writeUserConfig(io, file, current);
            return true;
        };
        const result = (this._configQueue || Promise.resolve()).then(run, run);
        this._configQueue = result.catch(() => {});
        return result;
    },

    /**
     * Write the abbreviations file through a temporary file that is then moved
     * into place, so a crash part-way through cannot leave it half-written.
     */
    async _writeUserConfig(io, file, config) {
        const text = JSON.stringify(config, null, 2);
        try {
            await io.writeUTF8(file, text, { tmpPath: file + '.tmp' });
        } catch (e) {
            this.log('Safe write failed (' + e + '); writing the file directly');
            await io.writeUTF8(file, text);
        }
    },

    /** Absolute path to the user-editable dictionary, or null if unavailable. */
    _userDictionaryPath() {
        let dataDir;
        try { dataDir = Zotero.DataDirectory && Zotero.DataDirectory.dir; } catch (e) {}
        if (!dataDir) return null;
        return this._joinPath(dataDir, 'abbreviation-helper', 'abbreviations.json');
    },

    /** Ensure the user dictionary file exists (creating it), returning its path. */
    async _ensureUserDictionaryFile() {
        const file = this._userDictionaryPath();
        if (!file) return null;
        try {
            const io = await this._getIOUtils();
            if (!(await io.exists(file))) {
                const dir = this._joinPath(Zotero.DataDirectory.dir, 'abbreviation-helper');
                await io.makeDirectory(dir, { ignoreExisting: true });
                await io.writeUTF8(file, JSON.stringify(this._starterUserConfig(), null, 2));
                this.log('Created editable user dictionary at ' + file);
            }
        } catch (e) {
            this.log('Could not ensure user dictionary file: ' + e);
        }
        return file;
    },

    /**
     * Open the user dictionary so it can be edited. Reveals it in the OS file
     * manager (most reliable for choosing an editor); falls back to launching
     * the file directly, then to showing the path.
     */
    async _openUserDictionary(window) {
        try {
            try { await this._dictionariesReady; } catch (e) {}
            const file = await this._ensureUserDictionaryFile();
            if (!file) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Could not locate the Zotero data directory to create the abbreviations file.');
                return;
            }
            try {
                // Asynchronous in every supported Zotero, so it must be awaited
                // for a failure to reach the fallbacks below.
                await Zotero.File.reveal(file);
                return;
            } catch (e) {
                this.log('reveal failed, trying launchFile: ' + e);
            }
            try {
                Zotero.launchFile(file);
                return;
            } catch (e) {
                this.log('launchFile failed: ' + e);
            }
            Zotero.alert(window, 'Abbreviation Helper',
                'Your abbreviations file is here:\n\n' + file +
                '\n\nOpen it in any text editor, add entries, then choose "Reload from file" in Settings.');
        } catch (e) {
            this.log('Could not open the abbreviations file: ' + e);
        }
    },

    /** Re-read the dictionaries from disk and refresh the active reader. */
    async _reloadDictionaries(window) {
        try {
            this._dictionariesReady = this._loadDictionaries();
            await this._dictionariesReady;
            await this._redetect();
            if (window && this.userFileError) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Your abbreviations file could not be read, so your own entries are not in use.\n\n'
                    + this.userFileError + '\n\nOpen the file, correct it, then reload it. '
                    + 'The plugin will not change the file until then.');
            } else if (window) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Abbreviations file reloaded: ' +
                    Object.keys(this.dictionaries.staticDefs).length + ' static and ' +
                    Object.keys(this.dictionaries.commonKnownDefs).length + ' glossary entries.');
            }
        } catch (e) {
            this.log('Reload failed: ' + e);
            if (window) Zotero.alert(window, 'Abbreviation Helper', 'Could not reload the abbreviations file. See the Zotero log for details.');
        }
    },

    /**
     * Detect again in every paper, after something detection depends on has
     * changed: the open paper at once (its text is cached, so the PDF is not
     * read again), the others when they are next opened.
     */
    _redetect() {
        try { this.cache.clear(); } catch (e) {}
        this._setActiveHoverPairs(null, []);
        return this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
    },

    /** Store a scan result, evicting the oldest entry past CACHE_LIMIT. */
    _cacheResult(itemID, pairs) {
        try {
            if (this.cache.has(itemID)) this.cache.delete(itemID);
            this.cache.set(itemID, pairs);
            while (this.cache.size > this.CACHE_LIMIT) {
                const oldest = this.cache.keys().next().value;
                this.cache.delete(oldest);
            }
        } catch (e) {
            this.log('Could not cache scan result: ' + e);
        }
    },

    /**
     * Write a debug message prefaced with the plugin name.
     */
    log(msg) {
        Zotero.debug("Abbreviation Helper: " + msg);
    },

    /* ---- Zotero UI: Tools menu ------------------------------------------ */

    /**
     * Insert the Abbreviation Helper menu into the Tools menu of a Zotero
     * window. Does nothing if it is already there.
     *
     * @param {Window} window The Zotero window to modify.
     */
    addToWindow(window) {
        const doc = window.document;
        try {
            const toolsPopup = doc.getElementById('menu_ToolsPopup') || doc.getElementById('menu_toolsMenuPopup');
            if (!toolsPopup) {
                this.log('Could not locate Tools menu to insert menu item');
                return;
            }
            // Startup retries and the window hooks can both register UI for the
            // same window; if the menu is already there, do nothing.
            if (doc.getElementById('abbreviation-helper-menu')) return;

            const rootMenu = doc.createXULElement('menu');
            rootMenu.id = 'abbreviation-helper-menu';
            rootMenu.setAttribute('label', 'Abbreviation Helper');
            const rootPopup = doc.createXULElement('menupopup');
            rootMenu.appendChild(rootPopup);

            /* ---- small builders so the menu below reads as a layout ---- */
            const sep = (parent) => parent.appendChild(doc.createXULElement('menuseparator'));
            const header = (parent, label) => {
                const item = doc.createXULElement('menuitem');
                item.setAttribute('label', label);
                item.setAttribute('disabled', 'true');
                item.setAttribute('style', 'font-weight: bold; opacity: 0.85;');
                return parent.appendChild(item);
            };
            /* XUL dismisses the whole menu on every command. Settings are
             * usually changed several at a time, so anything that toggles a
             * setting stays open; anything that performs an action (scan, open
             * a file) still closes, because that is what you expect after
             * asking for something to happen.
             *
             * If a Zotero build ever stops honouring `closemenu`, the menu
             * simply closes as it used to — nothing breaks. */
            const keepOpen = (item) => { item.setAttribute('closemenu', 'none'); return item; };

            const action = (parent, id, label, onCommand, stayOpen) => {
                const item = doc.createXULElement('menuitem');
                if (id) item.id = id;
                item.setAttribute('label', label);
                if (stayOpen) keepOpen(item);
                item.addEventListener('command', () => onCommand(item));
                return parent.appendChild(item);
            };
            const checkbox = (parent, id, label, checked, onCommand) => {
                const item = doc.createXULElement('menuitem');
                if (id) item.id = id;
                item.setAttribute('label', label);
                item.setAttribute('type', 'checkbox');
                item.setAttribute('checked', checked ? 'true' : 'false');
                keepOpen(item);
                item.addEventListener('command', () => onCommand(item));
                return parent.appendChild(item);
            };
            const submenu = (parent, label) => {
                const menu = doc.createXULElement('menu');
                menu.setAttribute('label', label);
                const popup = doc.createXULElement('menupopup');
                menu.appendChild(popup);
                parent.appendChild(menu);
                return popup;
            };
            /* A set of radio items sharing one group name. Returns the items
             * so a caller can enable or disable them as a block. */
            const radioGroup = (parent, groupName, choices, current, onPick) => {
                const items = [];
                for (const choice of choices) {
                    const item = doc.createXULElement('menuitem');
                    item.setAttribute('type', 'radio');
                    item.setAttribute('name', groupName);
                    item.setAttribute('label', choice.label);
                    item.setAttribute('checked', choice.id === current ? 'true' : 'false');
                    keepOpen(item);
                    item.addEventListener('command', () => onPick(choice.id, item));
                    parent.appendChild(item);
                    items.push(item);
                }
                return items;
            };

            /* ---------------------------------------------------------------
             * Layout.
             *
             * Ordered by how often something is used. Actions you take
             * repeatedly (scan, correcting a wrong detection) stay at the top
             * level. The settings follow the Settings window: a submenu for
             * each of the three tooltips, starting with what shows it (Off,
             * Always or a key) and then its own options, greyed out while it
             * is off; then the appearance they share. Separators carry the
             * grouping, so no bold pseudo-headers are needed out here.
             *
             * Every reference to the settings file uses the same words —
             * "abbreviations file" — because there is only one of them.
             *
             * The menu is rebuilt each time it opens rather than once at
             * startup, so every control reflects the current settings, which
             * the Settings window may have changed meanwhile.
             * ------------------------------------------------------------- */
            const buildMenu = () => {
            while (rootPopup.firstChild) rootPopup.removeChild(rootPopup.firstChild);

            /* ---- Settings ---- */
            // macOS renders this menu as a native NSMenu, which always closes
            // on selection — there is no way to keep it open while changing
            // several settings. The Settings window has no such limit, so it
            // is the recommended route and sits first.
            action(rootPopup, 'abbreviation-helper-settings', 'Settings…', () => {
                this._openSettings(window);
            });
            sep(rootPopup);

            /* ---- Scan ---- */
            action(rootPopup, 'abbreviation-helper-scan', 'Scan This PDF and Copy List', () => {
                this.scanCurrent().catch(err => {
                    this.log('Error during scan: ' + err);
                    Zotero.alert(window, 'Abbreviation Helper', 'An error occurred while scanning the PDF. See the Zotero log for details.');
                });
            });
            sep(rootPopup);

            /* ---- The three tooltips ---- */
            // One submenu each. Its first choices switch it off or say which
            // key shows it, in one radio group; its options follow, greyed out
            // while it is off, so no visible control silently does nothing.
            const tooltipMenu = (id, label, onName, keyName, groupName, keys, addOptions) => {
                const popup = submenu(rootPopup, label);
                popup.parentNode.id = id;
                const options = [];
                const sync = () => {
                    for (const el of options) el.setAttribute('disabled', this[onName] ? 'false' : 'true');
                };
                radioGroup(popup, groupName, [{ id: '', label: 'Off' }, ...keys],
                    this[onName] ? this[keyName] : '', (key) => {
                        if (key) {
                            this[keyName] = key;
                            this._setPref(keyName, key);
                        }
                        if (!!key !== this[onName]) this._setTooltipOn(onName, !!key);
                        else this._refreshHoverFromLastState(doc);
                        sync();
                    });
                sep(popup);
                addOptions(popup, options);
                sync();
            };

            tooltipMenu('abbreviation-helper-meanings', '1 · Meanings', 'hoverEnabled', 'tooltipModifier',
                'abbrev-tooltip-mod', this._modifierChoices(), (popup, options) => {
                    options.push(checkbox(popup, 'abbreviation-helper-source',
                        'Say where each meaning comes from', this.showMeaningSource, (item) => {
                            this.showMeaningSource = !this.showMeaningSource;
                            this._setPref('showMeaningSource', this.showMeaningSource);
                            item.setAttribute('checked', this.showMeaningSource ? 'true' : 'false');
                            this._refreshHoverFromLastState(doc);
                        }));
                    options.push(checkbox(popup, 'abbreviation-helper-library',
                        'Use definitions from my other papers', this.useLibraryDefinitions, (item) => {
                            this.useLibraryDefinitions = !this.useLibraryDefinitions;
                            this._setPref('useLibraryDefinitions', this.useLibraryDefinitions);
                            item.setAttribute('checked', this.useLibraryDefinitions ? 'true' : 'false');
                            this._redetect();
                        }));
                });

            tooltipMenu('abbreviation-helper-links', '2 · Database Links', 'databaseLinksEnabled',
                'databaseLinksModifier', 'abbrev-db-mod', this._modifierChoices(), (popup, options) => {
                    options.push(checkbox(popup, 'abbreviation-helper-db-on-abbr',
                        'Also show them under a meaning', this.databaseLinksOnAbbreviations, (item) => {
                            this.databaseLinksOnAbbreviations = !this.databaseLinksOnAbbreviations;
                            this._setPref('databaseLinksOnAbbreviations', this.databaseLinksOnAbbreviations);
                            item.setAttribute('checked', this.databaseLinksOnAbbreviations ? 'true' : 'false');
                            this._refreshHoverFromLastState(doc);
                        }));
                    const dbPopup = submenu(popup, 'Databases');
                    dbPopup.parentNode.id = 'abbreviation-helper-databases';
                    options.push(dbPopup.parentNode);
                    // Rebuilt on open rather than at startup, so databases added to
                    // the abbreviations file show up as soon as it is reloaded
                    // instead of waiting for a Zotero restart.
                    dbPopup.addEventListener('popupshowing', () => {
                        while (dbPopup.firstChild) dbPopup.removeChild(dbPopup.firstChild);
                        const all = (this.dictionaries && this.dictionaries.databases) || [];
                        let firstGroup = true;
                        for (const groupLabel of this._databaseGroups()) {
                            if (!firstGroup) sep(dbPopup);
                            firstGroup = false;
                            header(dbPopup, groupLabel);
                            for (const db of all.filter(d => (d.group || 'Databases') === groupLabel)) {
                                checkbox(dbPopup, null, db.label, this._isDatabaseOn(db), (item) => {
                                    // Derive the new value from stored state, never from
                                    // the item's `checked` attribute: XUL has already
                                    // flipped that by the time this runs, so reading it
                                    // yields the old value and the click undoes itself.
                                    const nowOn = !this._isDatabaseOn(db);
                                    this._setDatabaseEnabled(db.label, nowOn);
                                    item.setAttribute('checked', nowOn ? 'true' : 'false');
                                    this._hideHoverTooltip(doc);
                                });
                            }
                        }
                        if (firstGroup) {
                            const none = doc.createXULElement('menuitem');
                            none.setAttribute('label', '(none configured)');
                            none.setAttribute('disabled', 'true');
                            dbPopup.appendChild(none);
                        }
                        sep(dbPopup);
                        action(dbPopup, null, 'Edit in Abbreviations File\u2026', () => {
                            this._openUserDictionary(window).catch(e => this.log('Open file failed: ' + e));
                        });
                    });
                });

            tooltipMenu('abbreviation-helper-uses', '3 · Where a Word Is Used', 'usesEnabled', 'usesModifier',
                'abbrev-uses-mod', this._usesModifierChoices(), (popup, options) => {
                    header(popup, 'Uses listed');
                    // Kept in step with the same list in settings.xhtml.
                    options.push(...radioGroup(popup, 'abbrev-uses-count',
                        [1, 3, 5, 10].map(n => ({ id: n, label: String(n) })), Number(this.usesCount), (n) => {
                            this.usesCount = n;
                            this._setPref('usesCount', n);
                            this._refreshHoverFromLastState(doc);
                        }));
                });

            const lookPopup = submenu(rootPopup, 'Tooltip Appearance');
            header(lookPopup, 'Text size');
            radioGroup(lookPopup, 'abbrev-font',
                // Kept in step with the same list in settings.xhtml.
                [{ id: 10, label: 'Very small' }, { id: 12, label: 'Small' },
                 { id: 14, label: 'Medium' }, { id: 16, label: 'Large' },
                 { id: 20, label: 'Very large' }],
                Number(this.tooltipFontSize), (id) => {
                    this.tooltipFontSize = id;
                    this._setPref('tooltipFontSize', id);
                    this._resetHoverTooltips();
                });
            sep(lookPopup);
            header(lookPopup, 'Theme');
            radioGroup(lookPopup, 'abbrev-theme',
                [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }],
                this.tooltipTheme, (id) => {
                    this.tooltipTheme = id;
                    this._setPref('tooltipTheme', id);
                    this._resetHoverTooltips();
                });

            /* ---- Correcting detections ---- */
            sep(rootPopup);
            action(rootPopup, 'abbreviation-helper-ignore', 'Ignore an Abbreviation\u2026', () => {
                this._promptIgnoreAbbreviation(window).catch(err => this.log('Ignore failed: ' + err));
            });
            // Built fresh each time it opens, so it always reflects the current
            // list; clicking an entry stops ignoring it.
            const ignoredMenu = doc.createXULElement('menu');
            ignoredMenu.id = 'abbreviation-helper-ignored-menu';
            ignoredMenu.setAttribute('label', 'Ignored Abbreviations');
            const ignoredPopup = doc.createXULElement('menupopup');
            ignoredMenu.appendChild(ignoredPopup);
            rootPopup.appendChild(ignoredMenu);
            // Rebuilt on open, and again after each removal: the list stays
            // open so several entries can be cleared in one visit, which means
            // it has to redraw itself rather than leaving stale rows behind.
            const buildIgnored = () => {
                while (ignoredPopup.firstChild) ignoredPopup.removeChild(ignoredPopup.firstChild);
                const list = this._ignoreList();
                if (!list.length) {
                    const none = doc.createXULElement('menuitem');
                    none.setAttribute('label', '(none ignored)');
                    none.setAttribute('disabled', 'true');
                    ignoredPopup.appendChild(none);
                    return;
                }
                header(ignoredPopup, 'Click to stop ignoring');
                for (const abbr of list) {
                    action(ignoredPopup, null, abbr, () => {
                        this._stopIgnoring(abbr)
                            .then(() => buildIgnored())
                            .catch(e => this.log('Un-ignore failed: ' + e));
                    }, true);
                }
                sep(ignoredPopup);
                action(ignoredPopup, null, 'Stop Ignoring All', () => {
                    this._setIgnoreList([])
                        .then(() => buildIgnored())
                        .catch(e => this.log('Clear ignore list failed: ' + e));
                }, true);
            };
            ignoredPopup.addEventListener('popupshowing', buildIgnored);

            /* ---- The abbreviations file ---- */
            sep(rootPopup);
            action(rootPopup, 'abbreviation-helper-open-dictionary', 'Open Abbreviations File\u2026', () => {
                this._openUserDictionary(window).catch(err => {
                    this.log('Error opening abbreviations file: ' + err);
                    Zotero.alert(window, 'Abbreviation Helper', 'Could not open the abbreviations file. See the Zotero log for details.');
                });
            });
            action(rootPopup, 'abbreviation-helper-reload-dictionary', 'Reload Abbreviations File', () => {
                this._reloadDictionaries(window).catch(err => this.log('Error reloading: ' + err));
            });

            // The count is part of the label, so it is set as the menu is
            // built; every other control was just drawn from current state.
            const n = this._ignoreList().length;
            ignoredMenu.setAttribute('label',
                n ? 'Ignored Abbreviations (' + n + ')' : 'Ignored Abbreviations');
            }; /* end buildMenu */

            // Rebuilding on open replaces the old re-sync patching: settings
            // are shared between windows and can be changed from the Settings
            // window at any time, so the menu re-reads preferences and redraws
            // rather than trusting what it drew at startup.
            rootPopup.addEventListener('popupshowing', (event) => {
                if (event.target !== rootPopup) return;
                this._loadPrefs();
                buildMenu();
            });
            buildMenu();

            toolsPopup.appendChild(rootMenu);
            if (this.addedElementIDs.indexOf(rootMenu.id) === -1) this.addedElementIDs.push(rootMenu.id);
        } catch (e) {
            this.log('Failed to add menu item: ' + e);
        }
    },

    /**
     * Open this plugin's pane in Zotero's Settings window. Falls back to
     * opening Settings at whatever pane it defaults to, which is still more
     * useful than doing nothing.
     */
    _openSettings(window) {
        try {
            if (window && typeof window.openPreferences === 'function') {
                window.openPreferences(this._prefPaneID || undefined);
                return;
            }
            if (Zotero.Utilities && Zotero.Utilities.Internal
                && Zotero.Utilities.Internal.openPreferences) {
                Zotero.Utilities.Internal.openPreferences(this._prefPaneID || undefined);
                return;
            }
            this.log('No way to open Settings on this Zotero version');
        } catch (e) {
            this.log('Could not open Settings: ' + e);
        }
    },

    /** Current ignore list (bundled defaults plus the user's own entries). */
    _ignoreList() {
        return ((this.dictionaries && this.dictionaries.ignore) || []).slice();
    },

    /** Replace the ignore list in your file and apply it immediately. */
    async _setIgnoreList(list) {
        const unique = (list || []).filter((x, i, a) => x && a.indexOf(x) === i);
        await this._editUserConfig((c) => { c.ignore = unique; });
        await this._reloadDictionaries(null);
    },

    /**
     * Remove one entry from the ignore list in your file. Works on the file's
     * own list, so entries shipped with the plugin are never copied into it.
     */
    async _stopIgnoring(abbr) {
        await this._editUserConfig((c) => {
            const before = Array.isArray(c.ignore) ? c.ignore : [];
            const after = before.filter(x => x !== abbr);
            if (after.length === before.length) return false;
            c.ignore = after;
        });
        await this._reloadDictionaries(null);
    },

    /* ---- Editing the abbreviations file from the Settings pane ----------
     * These wrap the abbreviations file so the pane never has to know its shape,
     * so both routes to a change — pane and hand-edited JSON — end up going
     * through the same validation. */

    /** Add one short form to the ignore list. */
    async _ignoreAbbreviation(abbr) {
        const name = String(abbr || '').trim();
        if (!name) return false;
        if (this._ignoreList().indexOf(name) !== -1) return true;
        await this._editUserConfig((c) => {
            const list = Array.isArray(c.ignore) ? c.ignore : [];
            if (list.indexOf(name) !== -1) return false;
            c.ignore = list.concat([name]);
        });
        await this._reloadDictionaries(null);
        return true;
    },

    /** The user's own definitions, as a plain {short form: meaning} object. */
    _userDefinitions() {
        return Object.assign({}, (this.dictionaries && this.dictionaries.userDefs) || {});
    },

    /**
     * Add or replace one of the user's definitions. These are authoritative:
     * they override whatever the paper says.
     */
    async _setUserDefinition(abbr, term) {
        const name = String(abbr || '').trim();
        const meaning = String(term || '').trim();
        if (!name || !meaning) return false;
        await this._editUserConfig((c) => {
            c.userDefs = this._plainObject(c.userDefs);
            c.userDefs[name] = meaning;
        });
        await this._reloadDictionaries(null);
        return true;
    },

    async _removeUserDefinition(abbr) {
        let removed = false;
        await this._editUserConfig((c) => {
            const defs = this._plainObject(c.userDefs);
            if (!Object.prototype.hasOwnProperty.call(defs, abbr)) return false;
            delete defs[abbr];
            c.userDefs = defs;
            removed = true;
        });
        if (removed) await this._reloadDictionaries(null);
        return removed;
    },

    /** `v` if it is a plain object, otherwise a new empty one. */
    _plainObject(v) {
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    },

    /**
     * Ask for an abbreviation to suppress and add it to the ignore list. The
     * token last hovered is offered as the default, which is usually the
     * false positive the user just saw.
     */
    async _promptIgnoreAbbreviation(window) {
        const suggestion = this.lastHoveredToken
            || (this.lastHoverState && this.lastHoverState.token) || '';
        const value = { value: suggestion };
        let ok = false;
        try {
            ok = Services.prompt.prompt(window, 'Abbreviation Helper',
                'Never show a meaning for which abbreviation?', value, null, {});
        } catch (e) {
            this.log('Prompt unavailable: ' + e);
            Zotero.alert(window, 'Abbreviation Helper',
                'Add unwanted abbreviations to the "ignore" list in your custom abbreviations file.');
            return;
        }
        const abbr = ok && value.value ? String(value.value).trim() : '';
        if (!abbr) return;
        try {
            await this._ignoreAbbreviation(abbr);
        } catch (e) {
            this.log('Could not add to the ignore list: ' + e);
            Zotero.alert(window, 'Abbreviation Helper', this._saveFailedMessage());
            return;
        }
        Zotero.alert(window, 'Abbreviation Helper', '\u201c' + abbr + '\u201d will no longer be shown.');
    },

    /**
     * Insert UI into all currently open Zotero windows.
     */
    addToAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
        this._startAutoScanTimer();
    },

    /**
     * Remove UI from a single Zotero window.
     */
    removeFromWindow(window) {
        let doc = window.document;
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) elem.remove();
        }
    },

    /**
     * Remove UI from all open windows and clear stored element IDs.
     */
    removeFromAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
        this._removeHoverListeners();
        this._stopAutoScanTimer();
        this.addedElementIDs = [];
    },

    /**
     * Called first when the plugin shuts down. Marks it stopped, so a scan
     * still waiting on Zotero's PDF worker does nothing when it finishes, and
     * stops the background scan and the tab watcher.
     */
    stop() {
        this._stopped = true;
        this._flushLibrary();
        this._stopAutoScanTimer();
        this._clearCorridor();
        this._cancelHoverHide();
    },

    /* ---- Scanning and PDF text extraction ------------------------------ */

    /**
     * Scan a PDF for abbreviation definitions: the one open in the active
     * reader tab, or, when the library is showing, the first PDF of the
     * selected item (options.readerOnly skips the library). Unless
     * options.silent is set, the list is copied to the clipboard and a preview
     * is shown. Results are cached per item.
     */
    async scanCurrent(options) {
        options = options || {};
        const info = await this._getCurrentAttachment({ readerOnly: !!options.readerOnly });
        if (!info) {
            if (!options.silent) {
                Zotero.alert(null, 'Abbreviation Helper', 'Please open a PDF in the Zotero reader or select an item with a PDF attachment.');
            }
            return;
        }
        // Ensure the full dictionary has loaded before detecting so results and
        // the per-item cache are computed with the complete dictionary.
        try { await this._dictionariesReady; } catch (e) {}
        if (this._stopped) return;
        let pairs;
        try {
            pairs = await this._pairsForItem(info.item);
        } catch (err) {
            this.log('Failed to extract text: ' + err);
            throw err;
        }
        if (this._stopped) return pairs;
        this._setActiveHoverPairs(info.item.id, pairs);
        if (this._anyTooltipOn()) this._installHoverForAllWindows();
        if (!options.silent) this._showDialog(pairs);
        return pairs;
    },

    /**
     * Detected pairs for an attachment, from the cache when possible. The
     * extracted text is cached separately (see textCache), so after a change
     * to the dictionaries only detection runs again, not extraction.
     */
    async _pairsForItem(item) {
        if (this.cache.has(item.id)) return this.cache.get(item.id);
        const text = await this._textForItem(item);
        try { await this._libraryReady; } catch (e) {}
        const pairs = this._detectAbbreviations(text, item);
        this._cacheResult(item.id, pairs);
        this.log(`Scanned item ${item.id}: ${pairs.length} abbreviation definitions found.`);
        return pairs;
    },

    /** Full text of an attachment, kept for the few most recently used items. */
    async _textForItem(item) {
        const cached = this.textCache.get(item.id);
        if (typeof cached === 'string') {
            // Refresh its place so the least recently used text is evicted first.
            this.textCache.delete(item.id);
            this.textCache.set(item.id, cached);
            return cached;
        }
        const text = await this._extractTextForItem(item);
        this.textCache.set(item.id, text);
        while (this.textCache.size > this.TEXT_CACHE_LIMIT) {
            this.textCache.delete(this.textCache.keys().next().value);
        }
        return text;
    },

    /**
     * Extract the full text of a PDF attachment with Zotero's own PDF worker.
     * `Zotero.PDFWorker.getFullText(itemID)` exists in every supported version
     * (7.0 to 10) and returns { text, ... } with a form feed between pages.
     * A PDF with no text layer gives an empty string, which simply yields no
     * abbreviations.
     *
     * @param {_ZoteroTypes.Item} item Attachment item representing the PDF
     * @returns {Promise<string>} The full extracted text
     */
    async _extractTextForItem(item) {
        const worker = Zotero.PDFWorker;
        if (!worker || typeof worker.getFullText !== 'function') {
            throw new Error('Zotero.PDFWorker.getFullText is not available');
        }
        const result = await worker.getFullText(item.id);
        // Page breaks (form feeds) are kept: the detector uses them to find
        // running headers and footers.
        return (result && typeof result.text === 'string') ? result.text : '';
    },

    /**
     * Item id of the attachment open in the selected reader tab, or null when
     * the library (or anything other than a reader) is selected.
     *
     * Zotero_Tabs belongs to the main window. A plugin's own scope is a
     * sandbox that does not contain it, so it is read from the window.
     */
    _activeReaderItemID() {
        const reader = this._activeReader();
        return (reader && reader.itemID) || null;
    },

    /** The reader in the selected tab, or null when the library is showing. */
    _activeReader() {
        let win = null;
        try { win = Zotero.getMainWindow ? Zotero.getMainWindow() : null; } catch (e) {}
        const tabs = win && win.Zotero_Tabs;
        if (!tabs || tabs.selectedType !== 'reader') return null;
        return (Zotero.Reader && typeof Zotero.Reader.getByTabID === 'function')
            ? Zotero.Reader.getByTabID(tabs.selectedID) || null : null;
    },

    /**
     * Find the PDF to work on and return { item, path }, or null.
     *
     * The PDF open in the active reader tab comes first. Otherwise (the
     * library is showing, or the reader holds something other than a PDF)
     * the selected item is used, unless options.readerOnly is set: the
     * attachment itself, or the first PDF of a regular item. The background
     * scan passes readerOnly, so browsing the library never triggers a scan.
     *
     * @returns {Promise<{ item: _ZoteroTypes.Item, path: string }|null>}
     */
    async _getCurrentAttachment(options) {
        options = options || {};
        try {
            const itemID = this._activeReaderItemID();
            if (itemID) {
                const found = await this._pdfAttachmentInfo(await Zotero.Items.getAsync(itemID));
                if (found) return found;
            }
        } catch (e) {
            this.log('Could not read the active reader tab: ' + e);
        }
        if (options.readerOnly) return null;

        const pane = Zotero.getActiveZoteroPane();
        if (!pane) return null;
        const sel = pane.getSelectedItems();
        if (!sel || !sel.length) return null;
        const item = sel[0];
        if (item.isAttachment && item.isAttachment()) {
            const found = await this._pdfAttachmentInfo(item);
            if (found) return found;
        }
        const attachments = item.getAttachments ? item.getAttachments() : [];
        for (const id of attachments) {
            const found = await this._pdfAttachmentInfo(await Zotero.Items.getAsync(id));
            if (found) return found;
        }
        return null;
    },

    /** { item, path } for a PDF attachment whose file path is known, else null. */
    async _pdfAttachmentInfo(att) {
        if (!att || !att.isAttachment || !att.isAttachment()) return null;
        if (!att.attachmentMIMEType || !att.attachmentMIMEType.includes('pdf')) return null;
        let path;
        if (typeof att.getFilePath === 'function') path = att.getFilePath();
        if (!path && typeof att.getFilePathAsync === 'function') {
            try { path = await att.getFilePathAsync(); } catch (e) {}
        }
        return path ? { item: att, path } : null;
    },

    /* ---- Abbreviation detection ----------------------------------------- */

    /**
     * Abbreviation/definition pairs for a paper's text. The detection itself
     * is the pure function detectAbbreviations() at the top of this file; this
     * adds the loaded dictionaries (bundled defaults merged with the user's)
     * and, when the setting is on, the definitions of the user's other papers,
     * then remembers the ones this paper gives.
     *
     * @param {string} text Text extracted from the PDF
     * @param {_ZoteroTypes.Item} [item] The PDF attachment, which identifies
     *   the paper in the library store; without it the library is not used.
     * @returns {Array<{abbr: string, term: string, source: string, certainty: string}>}
     */
    _detectAbbreviations(text, item) {
        const dicts = this.dictionaries || {};
        const key = item ? this._libraryKey(item) : null;
        if (!this.useLibraryDefinitions || !key) return detectAbbreviations(text, dicts);
        const pairs = detectAbbreviations(text, Object.assign({}, dicts, { library: this._libraryDefinitions(key) }));
        this._rememberDefinitions(key, pairs);
        return pairs;
    },

    /* ---- Definitions from the user's other papers -----------------------
     * Researchers read many papers from one field, where an abbreviation
     * usually means the same thing. So the definitions each paper gives (only
     * those the letters confirm) are kept, per PDF, in library-definitions.json
     * next to the abbreviations file, and offered for papers that use an
     * abbreviation without defining it, marked as coming from the library.
     * Nothing is kept or used while the setting is off. Only papers that are
     * opened (or scanned from the Tools menu) are read; the library is never
     * scanned as a whole. */

    LIBRARY_SAVE_DELAY: 2000,

    _libraryPath() {
        let dataDir;
        try { dataDir = Zotero.DataDirectory && Zotero.DataDirectory.dir; } catch (e) {}
        return dataDir ? this._joinPath(dataDir, 'abbreviation-helper', 'library-definitions.json') : null;
    },

    /**
     * A PDF's key in the store, stable across sessions and sync:
     * "library/paper/attachment". The paper is the parent item, so a paper's
     * supplement counts as the same paper, not as another one.
     */
    _libraryKey(item) {
        if (!item) return null;
        if (!item.key) return item.id != null ? 'id:' + item.id : null;
        return (item.libraryID != null ? item.libraryID : '') + '/' + (item.parentKey || item.key) + '/' + item.key;
    },

    /** The paper a store key belongs to: "library/paper"; any other key is its own paper. */
    _paperOfKey(key) {
        const parts = String(key || '').split('/');
        return parts.length === 3 ? parts[0] + '/' + parts[1] : String(key || '');
    },

    async _loadLibrary() {
        this.libraryStore = { items: {} };
        this._libraryIndex = null;
        const file = this._libraryPath();
        if (!file) return;
        try {
            const io = await this._getIOUtils();
            if (!(await io.exists(file))) return;
            const raw = JSON.parse(await io.readUTF8(file));
            if (raw && raw.items && typeof raw.items === 'object') this.libraryStore.items = raw.items;
        } catch (e) {
            // A damaged file only costs the meanings learned so far.
            this.log('Could not read the library definitions; starting afresh: ' + e);
        }
    },

    /**
     * Meanings the user's other papers define, as detectAbbreviations()
     * expects them: short form -> [{ term, papers }], counting papers rather
     * than PDFs and leaving out the paper `exceptKey` belongs to.
     */
    _libraryDefinitions(exceptKey) {
        this.libraryStore = this.libraryStore || { items: {} };
        if (!this._libraryIndex) {
            // short form -> spelling-independent meaning -> { term, papers }
            const index = new Map();
            for (const [key, defs] of Object.entries(this.libraryStore.items || {})) {
                const paper = this._paperOfKey(key);
                for (const [abbr, term] of Object.entries(defs || {})) {
                    const sf = singularShortForm(abbr) || abbr;
                    const id = flatten(term).replace(/s$/, '');
                    if (!index.has(sf)) index.set(sf, new Map());
                    const byMeaning = index.get(sf);
                    if (!byMeaning.has(id)) byMeaning.set(id, { term, papers: new Set() });
                    byMeaning.get(id).papers.add(paper);
                }
            }
            this._libraryIndex = index;
        }
        const own = this._paperOfKey(exceptKey);
        const out = {};
        for (const [sf, byMeaning] of this._libraryIndex) {
            const options = [];
            for (const m of byMeaning.values()) {
                const papers = m.papers.size - (m.papers.has(own) ? 1 : 0);
                if (papers > 0) options.push({ term: m.term, papers });
            }
            if (options.length) out[sf] = options;
        }
        return out;
    },

    /** How many papers definitions have been learned from (for Settings). */
    _libraryPaperCount() {
        const items = (this.libraryStore && this.libraryStore.items) || {};
        return new Set(Object.keys(items).map(k => this._paperOfKey(k))).size;
    },

    /**
     * Forget every definition learned so far, in memory and on disk, then
     * read the open paper again. Deleting the file by hand while Zotero runs
     * would not be enough: the copy in memory would be saved again.
     */
    async _forgetLibrary() {
        if (this._librarySaveTimer) clearTimeout(this._librarySaveTimer);
        this._librarySaveTimer = null;
        this.libraryStore = { items: {} };
        this._libraryIndex = null;
        await this._queueLibraryWrite(async () => {
            const file = this._libraryPath();
            if (!file) return;
            const io = await this._getIOUtils();
            if (await io.exists(file)) await io.remove(file);
        });
        await this._redetect();
    },

    /** Keep the definitions a paper gives (only those the letters confirm). */
    _rememberDefinitions(key, pairs) {
        const defs = {};
        for (const p of pairs || []) if (p.certainty === 'defined') defs[p.abbr] = p.term;
        this.libraryStore = this.libraryStore || { items: {} };
        const items = this.libraryStore.items;
        if (JSON.stringify(items[key] || {}) === JSON.stringify(defs)) return;
        if (Object.keys(defs).length) items[key] = defs;
        else delete items[key];
        this._libraryIndex = null;
        this._scheduleLibrarySave();
    },

    /** Save a moment after the last change, so opening papers in a row writes once. */
    _scheduleLibrarySave() {
        if (this._librarySaveTimer) clearTimeout(this._librarySaveTimer);
        this._librarySaveTimer = setTimeout(() => {
            this._librarySaveTimer = null;
            this._saveLibrary().catch(e => this.log('Could not save the library definitions: ' + e));
        }, this.LIBRARY_SAVE_DELAY);
    },

    /** Save now if a save is pending (at shutdown). */
    _flushLibrary() {
        if (!this._librarySaveTimer) return;
        clearTimeout(this._librarySaveTimer);
        this._librarySaveTimer = null;
        this._saveLibrary().catch(e => this.log('Could not save the library definitions: ' + e));
    },

    /**
     * Run writes to the library file one after another, so a save at
     * shutdown or after "Forget" never overlaps one already under way.
     */
    _queueLibraryWrite(write) {
        const run = this._libraryWrites ? this._libraryWrites.then(write, write) : write();
        this._libraryWrites = run.catch(() => {});
        return run;
    },

    _saveLibrary() {
        return this._queueLibraryWrite(async () => {
            const file = this._libraryPath();
            if (!file) return;
            const io = await this._getIOUtils();
            await io.makeDirectory(this._joinPath(Zotero.DataDirectory.dir, 'abbreviation-helper'), { ignoreExisting: true });
            // Taken when the write starts, so it holds every change made until then.
            const text = JSON.stringify({
                _comment: 'Definitions read in the papers you opened, used for papers that do not define an '
                    + 'abbreviation. Kept by Abbreviation Helper; forget them in its settings.',
                version: 1,
                items: this.libraryStore.items
            });
            try {
                await io.writeUTF8(file, text, { tmpPath: file + '.tmp' });
            } catch (e) {
                await io.writeUTF8(file, text);
            }
        });
    },

    /**
     * Copy the detected pairs to the clipboard and show a preview of the
     * first 35 in an alert. If nothing was detected, say so instead.
     *
     * @param {Array<{ abbr: string, term: string }> } pairs Array of
     * abbreviation-definition objects
     */
    _showDialog(pairs) {
        if (!pairs || !pairs.length) {
            Zotero.alert(null, 'Abbreviation Helper', 'No abbreviation definitions were detected.');
            return;
        }
        const lines = pairs.map(p => `${p.abbr} — ${p.term}`);
        const fullMessage = lines.join('\n');

        // Long Zotero alerts are hard to scroll and copy.  Always copy the
        // full abbreviation list to the system clipboard, then show only a
        // preview in the alert.  This keeps the UI usable for papers with
        // dozens of abbreviations.
        let copied = false;
        try {
            const clipboard = Components.classes['@mozilla.org/widget/clipboardhelper;1']
                .getService(Components.interfaces.nsIClipboardHelper);
            clipboard.copyString(fullMessage);
            copied = true;
        } catch (e) {
            try {
                Zotero.Utilities.Internal.copyTextToClipboard(fullMessage);
                copied = true;
            } catch (e2) {
                this.log('Could not copy abbreviations to clipboard: ' + e2);
            }
        }

        const maxLines = 35;
        let preview = lines.slice(0, maxLines).join('\n');
        if (lines.length > maxLines) {
            preview += `\n\n… ${lines.length - maxLines} more entries not shown here.`;
        }
        const header = `${pairs.length} abbreviation definitions found.` +
            (copied ? '\nFull list copied to clipboard.' : '\nFull list could not be copied automatically.');
        Zotero.alert(null, 'Abbreviation Helper', header + '\n\n' + preview);
    },

    /* ---- Hover tooltips in the Zotero reader ---------------------------- */

    /** Is at least one of the three tooltips switched on? */
    _anyTooltipOn() {
        return !!(this.hoverEnabled || this.databaseLinksEnabled || this.usesEnabled);
    },

    /**
     * Switch one of the three tooltips on or off, by its setting's name
     * (the Tools menu). Switching one on reads the PDF in the reader quietly
     * and listens to its pages; with all three off, the pages are left alone.
     */
    _setTooltipOn(name, on) {
        this[name] = !!on;
        this._setPref(name, !!on);
        if (!this._anyTooltipOn()) {
            this._removeHoverListeners();
            return;
        }
        this._refreshHoverFromLastState(null);
        this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
    },

    /**
     * Start the background scan: right away when a reader tab is selected,
     * plus a check every 2.5 s as a safety net and to attach hover listeners
     * to reader pages that finish rendering later.
     */
    _startAutoScanTimer() {
        if (this.autoScanTimer) return;
        this.autoScanTimer = setInterval(() => {
            this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
        }, 2500);
        // Try once shortly after startup/window injection. Tracked so that
        // disabling the plugin within the first second cannot leave a pending
        // scan that runs after shutdown.
        this.autoScanFirstRun = setTimeout(() => {
            this.autoScanFirstRun = null;
            this._autoScanActiveReader().catch(e => this.log('Initial auto-scan failed: ' + e));
        }, 1200);
        this._watchTabs();
    },

    _stopAutoScanTimer() {
        if (this.autoScanTimer) {
            clearInterval(this.autoScanTimer);
            this.autoScanTimer = null;
        }
        if (this.autoScanFirstRun) {
            clearTimeout(this.autoScanFirstRun);
            this.autoScanFirstRun = null;
        }
        this._unwatchTabs();
        this.autoScanInProgress = false;
        this._autoScanAgain = false;
    },

    /**
     * Rescan as soon as the user switches to (or loads) a reader tab, so the
     * meanings shown always belong to the paper on screen. Zotero announces
     * tab changes through its notifier in every supported version; if this
     * cannot be set up, the 2.5 s timer still catches up.
     */
    _watchTabs() {
        if (this._tabObserverID) return;
        try {
            if (!Zotero.Notifier || typeof Zotero.Notifier.registerObserver !== 'function') return;
            this._tabObserverID = Zotero.Notifier.registerObserver({
                notify: (event, type) => {
                    if (this._stopped || type !== 'tab') return;
                    if (event !== 'select' && event !== 'load') return;
                    // Read the new tab once Zotero has finished switching to it.
                    setTimeout(() => {
                        this._autoScanActiveReader().catch(e => this.log('Auto-scan after a tab change failed: ' + e));
                    }, 100);
                }
            }, ['tab'], 'abbreviationHelper');
        } catch (e) {
            this._tabObserverID = null;
            this.log('Could not watch tab changes; relying on the timer: ' + e);
        }
    },

    _unwatchTabs() {
        try {
            if (this._tabObserverID && Zotero.Notifier && Zotero.Notifier.unregisterObserver) {
                Zotero.Notifier.unregisterObserver(this._tabObserverID);
            }
        } catch (e) {}
        this._tabObserverID = null;
    },

    /**
     * Make sure the meanings in use belong to the PDF open in the active
     * reader tab. Only the reader counts: browsing the library never starts a
     * scan. Called by the timer, on tab changes and after settings change.
     */
    async _autoScanActiveReader() {
        if (this._stopped || !this._anyTooltipOn()) return;
        // One scan at a time; a request that arrives meanwhile (a quick second
        // tab switch, say) runs once the current scan has finished.
        if (this.autoScanInProgress) {
            this._autoScanAgain = true;
            return;
        }
        this.autoScanInProgress = true;
        let itemID = null;
        try {
            try { await this._dictionariesReady; } catch (e) {}
            if (this._stopped) return;
            let info = null;
            try {
                info = await this._getCurrentAttachment({ readerOnly: true });
            } catch (e) {
                this.log('Could not inspect active reader for auto-scan: ' + e);
                return;
            }
            if (this._stopped || !info || !info.item) return;

            itemID = info.item.id;
            if (itemID === this.activeHoverItemID) {
                // Already showing this paper (even if it defines nothing).
                // Only attach listeners to reader pages rendered since.
                this._installHoverForAllWindows();
                return;
            }
            // A PDF that just failed (no file yet, password, …) is retried
            // after 30 s rather than on every tick.
            const failed = this._lastAutoScanFailure;
            if (failed && failed.itemID === itemID && Date.now() - failed.time < 30000) return;

            const pairs = await this._pairsForItem(info.item);
            if (this._stopped) return;
            this._lastAutoScanFailure = null;
            this._setActiveHoverPairs(itemID, pairs);
            this._installHoverForAllWindows();
        } catch (e) {
            if (itemID != null) this._lastAutoScanFailure = { itemID, time: Date.now() };
            this.log('Auto-scan extraction/detection failed: ' + e);
        } finally {
            this.autoScanInProgress = false;
            if (this._autoScanAgain && !this._stopped) {
                this._autoScanAgain = false;
                this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
            }
        }
    },

    _setActiveHoverPairs(itemID, pairs) {
        // A tooltip still showing another paper's meaning goes (after a quick
        // tab switch, the pointer may not have moved since).
        if (itemID !== this.activeHoverItemID && this.hoverPinnedDoc) this._forgetHover(this.hoverPinnedDoc);
        this.activeHoverItemID = itemID;
        this.activeHoverMap = this._buildHoverMap(pairs || []);
        // The meanings changed, so the next mouse move redraws the tooltip.
        this._renderedSig = null;
        this._mapGeneration = (this._mapGeneration || 0) + 1;
    },

    /**
     * Index a paper's meanings by every spelling a reader may hover. Each
     * value is { abbr, term, certainty }: the short form as detected (what
     * "Ignore an Abbreviation…" offers), the meaning, and how sure it is.
     */
    _buildHoverMap(pairs) {
        const map = new Map();
        const entries = [];
        for (const pair of pairs || []) {
            const abbr = String((pair && pair.abbr) || '').trim();
            const term = String((pair && pair.term) || '').trim();
            if (abbr && term) entries.push({ abbr, term, certainty: pair.certainty || 'defined' });
        }
        // Every short form exactly as detected goes in first, so a variant
        // made from one entry can never replace another entry of the paper:
        // the "Ab" variant of "Aβ" must not overwrite "Ab = antibody".
        for (const e of entries) map.set(e.abbr, e);
        const addVariant = (key, e) => {
            if (key && !map.has(key)) map.set(key, e);
        };
        for (const e of entries) {
            // Spellings PDF text extraction produces.
            addVariant(e.abbr.replace(/β/g, 'b').replace(/Β/g, 'B'), e);
            addVariant(e.abbr.replace(/-/g, '‑'), e);
            addVariant(e.abbr.replace(/‑/g, '-'), e);
            // Papers define one number and use both: "extracellular vesicles
            // (EVs)" then "EV", or "extracellular vesicle (EV)" then "EVs".
            addVariant(singularShortForm(e.abbr), e);
            if (!e.abbr.endsWith('s')) {
                addVariant(e.abbr + 's', e);
                addVariant(e.abbr + 'S', e);
            }
        }
        return map;
    },

    /**
     * Attach hover listeners to every reader page that shows PDF text (the
     * PDF view or its Reading Mode) and does not have them yet. Listeners
     * stay attached while the meanings change (they always read the current
     * map), so this never tears anything down and is cheap to call often.
     */
    _installHoverForAllWindows() {
        if (this._stopped || !this._anyTooltipOn()) return;
        if ((!this.activeHoverMap || !this.activeHoverMap.size) && !this._enabledDatabases().length
            && !this.usesEnabled) return;
        this._pruneHoverDocs();
        let windows = [];
        try { windows = Zotero.getMainWindows(); } catch (e) { windows = []; }
        for (let win of windows) {
            try { this._installHoverInWindow(win); } catch (e) { this.log('Failed to install hover in window: ' + e); }
        }
    },

    _installHoverInWindow(window) {
        this._followKeysIn(window);
        const docs = this._getReaderDocuments(window);
        for (let doc of docs) {
            if (!doc || !doc.body) continue;
            if (this.hoverDocs.some(rec => rec.doc === doc)) continue;
            if (!this._showsPdfText(doc)) continue;
            const move = (event) => this._onReaderMouseMove(doc, event);
            const out = (event) => this._onReaderMouseLeave(doc, event);
            const scroll = () => this._forgetHover(doc);
            const click = (event) => this._onReaderClick(doc, event);
            const keydown = (event) => this._onReaderKeyDown(doc, event);
            const keyup = (event) => this._onReaderKeyUp(doc, event);
            const blur = () => this._onReaderBlur(doc);
            // Key-up is listened for on the window only: it sees every key-up
            // the document does, so listening on both ran the handler twice.
            const keyTarget = doc.defaultView || doc;
            doc.addEventListener('mousemove', move, true);
            doc.addEventListener('mouseleave', out, true);
            doc.addEventListener('scroll', scroll, true);
            doc.addEventListener('click', click, true);
            doc.addEventListener('keydown', keydown, true);
            keyTarget.addEventListener('keyup', keyup, true);
            try { if (doc.defaultView) doc.defaultView.addEventListener('blur', blur, true); } catch (e) {}
            this.hoverDocs.push({ doc, move, out, scroll, click, keydown, keyup, keyTarget, blur });
        }
    },

    /**
     * Follow the keys in a main window as well, ahead of everything else.
     *
     * Modifiers: with the keyboard focus outside the paper (the reader's
     * toolbar, the item pane), the reader's pages never see the key, and a
     * tooltip would not come when its key is pressed, or go when it is let
     * go, until the mouse moved. Reacting to one twice changes nothing.
     *
     * Numbers: a key pressed in the reader passes through the main window
     * first, on its way down to the page, and Zotero takes Ctrl/Cmd+1-9
     * there (to switch tabs) and the reader Alt+1-8 below it (its tools).
     * A number meant for the tooltip has to be taken here, before them (see
     * _chooseByNumber); the page's own listener then never sees it.
     */
    _followKeysIn(window) {
        this.keyWindows = this.keyWindows.filter(rec => { try { return !rec.win.closed; } catch (e) { return false; } });
        if (!window || this.keyWindows.some(rec => rec.win === window)) return;
        const down = (event) => {
            if (!event) return;
            if (this.MODIFIER_KEYS[event.key]) this._onModifierKey(null, event, true);
            else this._chooseByNumber(event);
        };
        const up = (event) => this._onReaderKeyUp(null, event);
        try {
            window.addEventListener('keydown', down, true);
            window.addEventListener('keyup', up, true);
            this.keyWindows.push({ win: window, down, up });
        } catch (e) {}
    },

    /**
     * Does this document show the text of a PDF? The PDF view has a text
     * layer. Zotero 10's Reading Mode shows the same paper reflowed as HTML in
     * a frame of its own: an article#sdt-content with the class sdt-pdf when
     * it comes from a PDF (Reading Mode for web snapshots lacks that class,
     * and the meanings found in a PDF do not apply there).
     */
    _showsPdfText(doc) {
        try {
            return !!doc.querySelector('.textLayer, [class*="textLayer"], #sdt-content.sdt-pdf');
        } catch (e) {
            return false;
        }
    },

    /** Forget reader pages that have gone away (a closed tab, a reloaded PDF). */
    _pruneHoverDocs() {
        this.hoverDocs = (this.hoverDocs || []).filter(rec => {
            try { return !!(rec.doc && rec.doc.defaultView); } catch (e) { return false; }
        });
    },

    _getReaderDocuments(window) {
        const docs = [];
        function addDoc(doc) {
            if (doc && docs.indexOf(doc) === -1) docs.push(doc);
        }
        function walkDoc(doc, depth) {
            if (!doc || depth > 3) return;
            addDoc(doc);
            let nodes = [];
            try { nodes = doc.querySelectorAll('iframe, frame, browser'); } catch (e) { nodes = []; }
            for (let node of nodes) {
                try {
                    if (node.contentDocument) walkDoc(node.contentDocument, depth + 1);
                    else if (node.contentWindow && node.contentWindow.document) walkDoc(node.contentWindow.document, depth + 1);
                } catch (e) {
                    // Cross-context reader frames may deny access. Ignore them.
                }
            }
        }
        try { walkDoc(window.document, 0); } catch (e) {}
        return docs;
    },

    _removeHoverListeners() {
        for (let rec of this.hoverDocs || []) {
            try {
                rec.doc.removeEventListener('mousemove', rec.move, true);
                rec.doc.removeEventListener('mouseleave', rec.out, true);
                rec.doc.removeEventListener('scroll', rec.scroll, true);
                if (rec.click) rec.doc.removeEventListener('click', rec.click, true);
                if (rec.keydown) rec.doc.removeEventListener('keydown', rec.keydown, true);
                if (rec.keyup) (rec.keyTarget || rec.doc).removeEventListener('keyup', rec.keyup, true);
                try { if (rec.doc.defaultView && rec.blur) rec.doc.defaultView.removeEventListener('blur', rec.blur, true); } catch (e) {}
                this._hideHoverTooltip(rec.doc);
                // Take the tooltip out of the page too, so nothing of the
                // plugin is left behind once hover is off or it is disabled.
                const tip = rec.doc.getElementById('abbreviation-helper-tooltip');
                if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
            } catch (e) {}
        }
        this.hoverDocs = [];
        for (const rec of this.keyWindows) {
            try {
                rec.win.removeEventListener('keydown', rec.down, true);
                rec.win.removeEventListener('keyup', rec.up, true);
            } catch (e) {}
        }
        this.keyWindows = [];
        this.lastHoverState = null;
    },

    _onReaderMouseMove(doc, event) {
        if (!this._anyTooltipOn() || this._stopped) return;
        this._updateModifierState(event);
        const x = event.clientX, y = event.clientY;

        // Over the tooltip itself. Only a tooltip with choices can be under
        // the pointer (a plain one lets the mouse pass through), and it stays
        // open, even when its key is let go, so a choice can be made.
        this._pointerOnTooltip = this._eventInTooltip(doc, event);
        if (this._pointerOnTooltip) {
            this._cancelHoverHide();
            this._clearCorridor();
            return;
        }
        // On the way from the word to a tooltip with links: hold it still for
        // a moment so the pointer can reach it across other words.
        if (this._inTooltipCorridor(doc, x, y)) {
            this._cancelHoverHide();
            this._pendingHover = { doc, x, y, target: event.target || null };
            if (!this._corridorTimer) {
                this._corridorTimer = setTimeout(() => {
                    this._corridorTimer = null;
                    const p = this._pendingHover;
                    this._pendingHover = null;
                    if (p && !this._stopped) this._hoverAt(p.doc, p.x, p.y, p.target);
                }, this.CORRIDOR_MS);
            }
            return;
        }
        this._clearCorridor();
        this._hoverAt(doc, x, y, event.target || null);
    },

    /** Show, keep or hide the tooltip for whatever is under (x, y). */
    _hoverAt(doc, x, y, target) {
        const token = this._wordAtPoint(doc, x, y);
        if (!token) {
            this.lastHoverState = null;
            this._scheduleHoverHide(doc, 120);
            return;
        }
        this._cancelHoverHide();

        // Still on the word the tooltip already shows: only follow the
        // pointer, without rebuilding the tooltip. A tooltip with links stays
        // put so it can be reached.
        const state = this.lastHoverState;
        if (state && state.doc === doc && state.token === token && state.target === target
            && this._renderedSig === this._hoverSignature(token) && this._isHoverTooltipVisible(doc)) {
            state.x = x;
            state.y = y;
            if (!this.hoverInteractiveTooltip) this._moveHoverTooltip(doc, x, y);
            return;
        }

        this.lastHoverState = { doc, x, y, token, dbToken: undefined, target };
        this._renderHoverFromState(this.lastHoverState);
    },

    /**
     * The pointer left an element. Only leaving the reader page itself (no
     * element to go to) closes the tooltip; moving between words, or onto a
     * tooltip with links, is handled by the mouse-move handler.
     */
    _onReaderMouseLeave(doc, event) {
        if (event && event.relatedTarget) return;
        this._forgetHover(doc);
    },

    /**
     * Hide the tooltip and forget the word it was for, so pressing a modifier
     * key or changing a setting later cannot bring it back at a stale place.
     */
    _forgetHover(doc) {
        this.lastHoverState = null;
        this._hideHoverTooltip(doc);
    },

    _eventInTooltip(doc, event) {
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            return !!(tip && event && event.target && tip.contains(event.target));
        } catch (e) {
            return false;
        }
    },

    /**
     * True when (x, y) lies on the way from the hovered word to a visible
     * tooltip with links: inside the triangle from the point where the word
     * was hovered to the tooltip's near edge, widened by 24 px on each side.
     */
    _inTooltipCorridor(doc, x, y) {
        if (!this.hoverInteractiveTooltip || this.hoverPinnedDoc !== doc) return false;
        const a = this.hoverAnchor, b = this._tipBox;
        if (!a || !b || b.doc !== doc || !this._isHoverTooltipVisible(doc)) return false;
        const edgeY = (b.top >= a.y) ? b.top : b.top + b.height;
        const left = b.left - 24, right = b.left + b.width + 24;
        const side = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
        const d1 = side(x, y, a.x, a.y, left, edgeY);
        const d2 = side(x, y, left, edgeY, right, edgeY);
        const d3 = side(x, y, right, edgeY, a.x, a.y);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    },

    _clearCorridor() {
        if (this._corridorTimer) {
            clearTimeout(this._corridorTimer);
            this._corridorTimer = null;
        }
        this._pendingHover = null;
    },

    /** What the visible tooltip depends on besides position. */
    _hoverSignature(token) {
        const m = this.modifierState || {};
        return [token, !!m.shift, !!m.ctrl, !!m.alt, !!m.meta, this._mapGeneration || 0].join('|');
    },

    /** True on macOS; used only to label keys the way the platform names them. */
    _isMac() {
        try {
            if (typeof Zotero !== 'undefined' && typeof Zotero.isMac === 'boolean') return Zotero.isMac;
        } catch (e) {}
        try { return /Mac/i.test(Services.appinfo.OS || ''); } catch (e) {}
        return false;
    },

    /**
     * The modifier choices for the Tools menu and the Settings pane, in
     * display order, phrased to complete the heading they sit under
     * ("Meanings: Always" / "Meanings: Only while holding Shift"). The ids
     * are what gets persisted and must not change. On macOS the Control
     * setting is labelled for Command, the key Mac users reach for (both are
     * accepted, see _modifierSatisfied), and Alt is called Option.
     */
    _modifierChoices() {
        const mac = this._isMac();
        const hold = (key) => 'Only while holding ' + key;
        return [
            { id: 'none', label: 'Always' },
            { id: 'shift', label: hold('Shift') },
            { id: 'ctrl', label: hold(mac ? '\u2318 Command (or Control)' : 'Ctrl') },
            { id: 'alt', label: hold(mac ? '\u2325 Option' : 'Alt') }
        ];
    },

    /** The choices for tooltip 3: those of the other two, except "Always". */
    _usesModifierChoices() {
        return this._modifierChoices().filter(c => c.id !== 'none');
    },

    /** Record which modifiers are down, from any mouse or keyboard event. */
    _updateModifierState(event) {
        if (!event) return;
        this.modifierState = {
            shift: !!event.shiftKey,
            ctrl: !!event.ctrlKey,
            alt: !!event.altKey,
            meta: !!event.metaKey
        };
    },

    /**
     * True when the configured modifier for a feature is satisfied.
     *
     * On macOS the 'ctrl' setting accepts Command as well as Control, so one
     * stored preference behaves as each platform names it and a profile
     * moved between machines needs no change. Elsewhere Meta is the Windows
     * or Super key, which opens the Start menu or the desktop's overview when
     * let go, and only Ctrl counts.
     */
    _modifierSatisfied(which) {
        const name = String(which || 'none');
        if (name === 'none') return true;
        const m = this.modifierState || {};
        if (name === 'ctrl') return !!(m.ctrl || (m.meta && this._isMac()));
        return !!m[name];
    },

    _databaseLinksCurrentlyAllowed() {
        if (!this.databaseLinksEnabled) return false;
        return this._modifierSatisfied(this.databaseLinksModifier);
    },

    /**
     * Draw the tooltip for the word under the pointer. Each of the three
     * tooltips counts on its own: switched on, and its key held (or none
     * needed). Those that count show together, in one tooltip, so tooltips
     * that share a key, or that need none, add up rather than replace one
     * another.
     */
    _renderHoverFromState(state) {
        if (!state || !state.doc || !state.token) return;
        const doc = state.doc;
        const token = state.token;
        const meaningOn = this.hoverEnabled && this._modifierSatisfied(this.tooltipModifier);
        const linksOn = this._databaseLinksCurrentlyAllowed();
        const usesOn = this.usesEnabled && this._modifierSatisfied(this.usesModifier);
        if (!meaningOn && !linksOn && !usesOn) {
            this._hideHoverTooltip(doc);
            return;
        }

        // Looked up now rather than when the mouse moved, so a tooltip redrawn
        // later (a modifier key pressed, a setting changed) uses the current
        // meanings. Where a word is used looks a word with a meaning up by its
        // short form, so "EVs" and "anti-EV" find the uses of EV.
        const entry = this._lookupHover(token);
        const meaning = meaningOn ? entry : null;
        const usesWord = entry ? entry.abbr : this._trimToken(token);

        // The multi-word database phrase is only worked out when links may
        // actually be shown, then remembered for this word.
        let links = null;
        if (linksOn && (!meaning || this.databaseLinksOnAbbreviations)) {
            if (state.dbToken === undefined) {
                state.dbToken = this._databaseLookupCandidateAtPoint(state.target, token) || token;
            }
            links = this._lookupDatabaseLinks(state.dbToken || token);
        }
        const uses = usesOn ? this._usesOf(usesWord, state) : null;

        if (!meaning && !links && !uses) {
            this._renderedSig = null;
            this._scheduleHoverHide(doc, 120);
            return;
        }
        // The short form as detected, not as hovered ("DNA." at the end of a
        // sentence), so ignoring it matches the paper's entry.
        if (meaning) this.lastHoveredToken = meaning.abbr;
        this._showTooltip(doc, state.x, state.y, {
            word: meaning ? this._trimToken(token) : links ? links.symbol : usesWord,
            meaning: meaning && { term: meaning.term, certainty: meaning.certainty },
            links: links && links.groups,
            uses, usesWord
        });
        this._renderedSig = this._hoverSignature(token);
    },

    _refreshHoverFromLastState(docHint) {
        const state = this.lastHoverState;
        if (state && state.doc) {
            this._renderHoverFromState(state);
        } else if (docHint) {
            this._hideHoverTooltip(docHint);
        }
    },

    /**
     * Broad database lookup token support for hover-time links.
     *
     * This is intentionally a lookup layer, not an entity resolver.  It does
     * not assert that a token is a gene, protein, or cell line; it only decides
     * whether the token is useful enough to offer database-search shortcuts.
     * Because the user already chooses the database with number shortcuts, this
     * layer can be more permissive than the abbreviation detector while still
     * avoiding obvious PDF/navigation noise.
     */
    _databaseLookupCandidateAtPoint(target, baseToken) {
        // Multi-word database lookup phrases are handled by a generic
        // biomedical-name rule. This is lookup-only: it does not create new
        // abbreviation definitions and it does not assert that the phrase is a
        // resolved gene/protein. The rule deliberately requires both:
        //   1. a compact biochemical / gene-like anchor, and
        //   2. a biological head noun.
        // That keeps ordinary title-case prose from becoming database links.
        try {
            if (!target || !baseToken) return '';
            let el = target.nodeType === 1 ? target : target.parentElement;
            if (!el) return '';
            if (el.closest) {
                el = el.closest('.textLayer span, .textLayer div, span, div') || el;
            }
            const text = String(el.textContent || '').replace(/[\u2011\u2013\u2014]/g, '-');
            if (!text || text.length > 600) return '';
            const cleanBase = this._cleanDatabaseLookupToken(baseToken, 64);
            if (!cleanBase) return '';

            const re = this._dbPhraseRegex();
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text))) {
                const phrase = String(m[0] || '').replace(/\s+/g, ' ').trim();
                if (!this._isPlausibleBiomoleculeLookupPhrase(phrase)) continue;
                const parts = phrase.split(/[\s\-]+/).filter(Boolean);
                if (parts.some(p => p === cleanBase || p.replace(/[.,;:]+$/,'') === cleanBase)) return phrase;
            }
        } catch (e) {}
        return '';
    },

    /**
     * The multi-word lookup phrase pattern, built once.
     *
     * Keep phrase lookup narrow.  The previous version allowed normal
     * lowercase words before and after the biological phrase, so hovering
     * near "HMG CoA synthase" could produce "enzyme HMG CoA synthase
     * in the".  Here the phrase must start with a code-like/biochemical
     * anchor and end at a biological head noun.  This catches terms such
     * as "HMG CoA synthase" without swallowing surrounding prose.
     *
     * It has the g flag, so callers reset lastIndex before using it.
     */
    _dbPhraseRegex() {
        if (!this._dbPhraseRe) {
            const bioHeadNouns = this._bioLookupHeadNouns().join('|');
            const anchorWord = '(?:[A-Z]{2,10}|[A-Z]+\\d+[A-Za-z0-9]*|[A-Z][a-z]{1,4}[A-Z][A-Za-z0-9]{0,8}|[A-Z]{1,4}[αβγδκ][A-Za-z0-9-]*|[αβγδκ][A-Za-z0-9-]*|CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)';
            const midWord = '(?:' + anchorWord + '|[A-Z][a-z]{1,20}|[a-z]{2,20})';
            this._dbPhraseRe = new RegExp('\\b' + anchorWord + '(?:[ \\-]+(?:' + midWord + ')){0,4}[ \\-]+(?:' + bioHeadNouns + ')\\b', 'g');
        }
        return this._dbPhraseRe;
    },

    /** Whole-word match for a biological head noun, built once. */
    _bioNounRegex() {
        if (!this._bioNounRe) {
            this._bioNounRe = new RegExp('^(?:' + this._bioLookupHeadNouns().join('|') + ')$', 'i');
        }
        return this._bioNounRe;
    },

    _bioLookupHeadNouns() {
        return [
            'synthase','reductase','kinase','phosphatase','transferase','dehydrogenase',
            'hydrogenase','oxidase','oxygenase','peroxidase','hydrolase','ligase',
            'isomerase','carboxylase','decarboxylase','polymerase','protease','peptidase',
            'nuclease','endonuclease','exonuclease','methylase','demethylase','acetylase',
            'deacetylase','receptor','transporter','channel','pump','protein','factor',
            'enzyme','subunit','complex','pathway','domain','motif','isoform','homolog',
            'ortholog','paralog','transcript','gene','oncogene','antigen','cytokine',
            'chemokine','integrin','cadherin','selectin','lectin','globulin','collagen'
        ];
    },

    _isPlausibleBiomoleculeLookupPhrase(phrase) {
        if (!phrase) return false;
        const p = String(phrase).replace(/[\u2011\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
        if (p.length < 7 || p.length > 90) return false;
        const parts = p.split(/[\s\-]+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 9) return false;

        const blocked = new Set(['FIGURE','TABLE','METHOD','METHODS','RESULT','RESULTS','SUPPLEMENTARY','MATERIALS','INTRODUCTION','DISCUSSION','REFERENCES','AUTHOR','AUTHORS','ARTICLE','ABSTRACT']);
        if (parts.some(t => blocked.has(t.toUpperCase()))) return false;

        // Code-like / biochemical anchors. This is intentionally generic:
        // uppercase roots, gene-like mixed-case symbols, digit-bearing symbols,
        // Greek-letter markers, and recurring biochemical cofactor names.
        const anchorRe = /^(?:[A-Z]{2,10}|[A-Z]+\d+[A-Za-z0-9]*|[A-Z][a-z]{1,4}[A-Z][A-Za-z0-9]{0,8}|[A-Z]{1,4}[αβγδκ][A-Za-z0-9-]*|[αβγδκ][A-Za-z0-9-]*|CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)$/;
        // Multi-word lookup phrases must be anchored at the start, not merely
        // contain an uppercase token somewhere in the middle. This prevents
        // surrounding prose such as "enzyme ... in the" from being captured.
        if (!anchorRe.test(parts[0])) return false;

        // Biological head nouns. The phrase should end at the head noun, again
        // to avoid swallowing nearby lowercase text after the useful term.
        if (!this._bioNounRegex().test(parts[parts.length - 1])) return false;

        // Require the phrase to include at least one lowercase-containing word
        // or a biochemical cofactor. This filters out runs of pure capitals.
        const hasReadableWord = parts.some(t => /[a-z]/.test(t) || /^(?:CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)$/.test(t));
        if (!hasReadableWord) return false;

        return true;
    },

    /* ---- External database lookup links -------------------------------- */

    /** Databases from the abbreviations file, minus any switched off. */
    _enabledDatabases() {
        // The master switch short-circuits everything downstream: link lookup,
        // the tooltip section, and the hover listener's early-out.
        if (!this.databaseLinksEnabled) return [];
        const all = (this.dictionaries && this.dictionaries.databases) || [];
        return all.filter(d => d && this._isDatabaseOn(d));
    },

    /**
     * Whether one database is currently on. The menu is authoritative: an
     * explicit choice made there outranks the `enabled` flag in the file, so
     * a database shipped as `enabled: false` can still be switched on rather
     * than being a checkbox that does nothing.
     */
    _isDatabaseOn(db) {
        if (!db || !db.label) return false;
        if (this._disabledDatabaseLabels().has(db.label)) return false;
        if (this._enabledDatabaseLabels().has(db.label)) return true;
        return db.enabled !== false;
    },

    /** Labels switched off via the Tools menu (persisted as a preference). */
    _disabledDatabaseLabels() {
        return this._labelSet('disabledDatabases');
    },

    /** Labels switched on via the Tools menu, overriding the file's default. */
    _enabledDatabaseLabels() {
        return this._labelSet('enabledDatabases');
    },

    _labelSet(pref) {
        const raw = String(this._getPref(pref, '') || '');
        return new Set(raw.split('|').map(x => x.trim()).filter(Boolean));
    },

    _setDatabaseEnabled(label, enabled) {
        // Both lists are maintained so the two prefs can never disagree.
        const off = this._disabledDatabaseLabels();
        const on = this._enabledDatabaseLabels();
        if (enabled) { off.delete(label); on.add(label); }
        else { on.delete(label); off.add(label); }
        this._setPref('disabledDatabases', [...off].join('|'));
        this._setPref('enabledDatabases', [...on].join('|'));
    },

    /** Distinct group names, in the order they appear in the config. */
    _databaseGroups() {
        const all = (this.dictionaries && this.dictionaries.databases) || [];
        const seen = [];
        for (const d of all) {
            const g = d.group || 'Databases';
            if (seen.indexOf(g) === -1) seen.push(g);
        }
        return seen;
    },

    _lookupDatabaseLinks(word) {
        const token = this._cleanDatabaseLookupToken(word, 80);
        if (!token) return null;
        const isPhrase = /\s/.test(token);
        if (isPhrase) {
            if (!this._isPlausibleBiomoleculeLookupPhrase(token)) return null;
        } else if (!this._isPlausibleDatabaseLookupToken(token)) {
            return null;
        }

        // Greek letters have no place in a URL query; transliterate them.
        const searchToken = token
            .replace(/[\u03b1\u0391]/g, 'A').replace(/[\u03b2\u0392]/g, 'B')
            .replace(/[\u03b3\u0393]/g, 'G').replace(/[\u03b4\u0394]/g, 'D');
        const q = encodeURIComponent(searchToken.replace(/-/g, ''));
        const qRaw = encodeURIComponent(searchToken);
        const expand = (url) => String(url).replace(/\{q\}/g, q).replace(/\{raw\}/g, qRaw);

        const enabled = this._enabledDatabases();
        if (!enabled.length) return null;

        const groups = [];
        for (const groupLabel of this._databaseGroups()) {
            const links = enabled
                .filter(d => (d.group || 'Databases') === groupLabel)
                .map(d => ({ label: d.label, url: expand(d.url) }));
            if (links.length) groups.push({ groupLabel, links });
        }
        if (!groups.length) return null;
        return { symbol: token, groups };
    },

    _cleanDatabaseLookupToken(word, maxLen) {
        let token = String(word || '').trim()
            .replace(/^[\s\(\[\{<"'“‘]+/, '')
            .replace(/[\s\)\]\}>"'”’.,;:]+$/, '')
            .replace(/[‑–—]/g, '-');
        if (!token) return '';

        // Remove common biomedical prose affixes only for lookup.  This means
        // anti-EGFR, EGFR-specific, and A549-derived all search the base token.
        const prefix = token.match(/^(anti|non)-(.+)$/i);
        if (prefix) token = prefix[2];
        const suffix = token.match(/^(.+)-(specific|mediated|dependent|independent|induced|responsive|associated|related|derived|targeted|targeting|expressing|positive|negative|binding|bound|deficient|enriched|depleted|like|based|infected|treated)$/i);
        if (suffix) token = suffix[1];

        token = token.replace(/^[\s\(\[\{<"'“‘]+/, '')
            .replace(/[\s\)\]\}>"'”’.,;:]+$/, '');
        if (!token || token.length < 2 || token.length > (maxLen || 32)) return '';
        return token;
    },

    _isPlausibleDatabaseLookupToken(token) {
        if (!token) return false;
        const normalized = String(token).trim().replace(/[‑–—]/g, '-');
        const compact = normalized.replace(/[-_.]/g, '');
        if (compact.length < 3 || compact.length > 32) return false;

        // Only uppercase/code-like or digit-bearing biomedical symbols should
        // trigger database lookup.  This intentionally rejects normal title-case
        // words such as Cholesterol, Surface, Introduction, Materials, etc. It
        // accepts all-caps/digit tokens such as TP53, A549, EDTA, 4-HNE, IL-6,
        // CD63, RAW264.7, and mixed-case gene/cell-line symbols with digits such
        // as MyD88, Huh7, and HepG2.
        const upperCodeLike = /^[A-Z0-9αβγδΑΒΓΔ][A-Z0-9αβγδΑΒΓΔ\-_.]{2,31}$/.test(normalized);
        const mixedDigitCodeLike = /^[A-Z][A-Za-z]{1,12}[\-_.]?[0-9][A-Za-z0-9\-_.]{0,16}$/.test(normalized);
        if (!upperCodeLike && !mixedDigitCodeLike) return false;
        if (!/[A-ZαβγδΑΒΓΔ]/.test(normalized)) return false;

        const blocked = new Set([
            'THE','AND','FOR','WITH','FROM','THIS','THAT','THEN','WHEN','WHERE','WHICH','ALSO','INTO','ONTO','OVER','UNDER','BETWEEN','AFTER','BEFORE','THESE','THOSE','SUCH','USING','USED','SHOW','SHOWS','DATA','RESULT','RESULTS','METHOD','METHODS','TABLE','FIG','FIGURE','PAGE','VOL','NO','DOI','HTTP','HTTPS','PDF','HTML','USA','UK','EU','MDPI','ELSEVIER','SPRINGER','WILEY','NATURE','SCIENCE'
        ]);
        if (blocked.has(compact.toUpperCase())) return false;

        // Reject plain section/page codes and bare numbers.
        if (/^\d+$/.test(compact)) return false;
        if (/^P\d+$/i.test(compact)) return false;

        return true;
    },

    /**
     * A hovered word without the brackets, quotes, punctuation and dashes
     * around it ("(EVs).", the "EV-" of "EV- and exosome-derived").
     */
    _trimToken(word) {
        return String(word || '').trim()
            .replace(/^[\s([{<"'“‘\-‐‑–—]+/, '')
            .replace(/[\s)\]}>"'”’.,;:\-‐‑–—]+$/, '');
    },

    // A known short form with one of these suffixes is explained too while
    // hovering ("EV-specific": specific to extracellular vesicles); X stands
    // for the meaning. Such forms are never added to the detected list.
    HOVER_SUFFIXES: {
        specific: 'specific to X', mediated: 'mediated by X', dependent: 'dependent on X',
        independent: 'independent of X', induced: 'induced by X', responsive: 'responsive to X',
        associated: 'associated with X', related: 'related to X', derived: 'derived from X',
        targeted: 'X-targeted', targeting: 'targeting X', expressing: 'expressing X',
        positive: 'X-positive', negative: 'X-negative', binding: 'binding X', bound: 'bound to X',
        deficient: 'deficient in X', enriched: 'enriched in X', depleted: 'depleted of X'
    },

    /**
     * The meaning of a hovered word in the paper on screen, as a hover-map
     * entry { abbr, term, certainty }, or null. Besides the short form itself,
     * "anti-X", "non-X" and X with one of HOVER_SUFFIXES are explained when X
     * is a short form the paper has a meaning for. Broader prefixes ("pre-",
     * "post-") are left out because they are often part of an ordinary word.
     */
    _lookupHover(word) {
        const map = this.activeHoverMap;
        const cleaned = this._trimToken(word);
        if (!cleaned || !map || !map.size) return null;
        const find = (s) => {
            for (const v of [s, s.replace(/[‑–—]/g, '-'), s.replace(/β/g, 'b').replace(/Β/g, 'B')]) {
                if (map.has(v)) return map.get(v);
            }
            return null;
        };
        const direct = find(cleaned);
        if (direct) return direct;

        const prefix = /^(anti|non)[-‑–—](.+)$/i.exec(cleaned);
        const prefixed = prefix && find(prefix[2]);
        if (prefixed) {
            const lead = prefix[1].toLowerCase() === 'anti' ? 'anti–' : 'non-';
            return this._affixed(prefixed, m => lead + m);
        }
        const suffix = /^(.+)[-‑–—]([A-Za-z]+)$/.exec(cleaned);
        const pattern = suffix && this.HOVER_SUFFIXES[suffix[2].toLowerCase()];
        const suffixed = pattern && find(suffix[1]);
        if (suffixed) return this._affixed(suffixed, m => pattern.replace('X', () => m));
        return null;
    },

    /**
     * An entry reworded for an affixed form. The note on where the meaning
     * comes from stays at the end, where the tooltip looks for it.
     */
    _affixed(entry, reword) {
        const { meaning, note } = this._splitNote(entry.term);
        return { abbr: entry.abbr, term: reword(meaning) + (note ? ' (' + note + ')' : ''), certainty: entry.certainty };
    },

    /**
     * The word under (x, y) in a reader page, or ''. Short forms joined by a
     * slash ("CD4/CD8") give the part under the pointer, unless the whole word
     * means something itself ("LC-MS/MS").
     */
    _wordAtPoint(doc, x, y) {
        // Letters and digits of any script ("Müller", "protéine", "β-actin"),
        // and what joins the parts of a short form ("IL-6", "RAW264.7", "CD4/CD8").
        const WORD_CHAR = /[\p{L}\p{M}\p{N}\-‐‑–—⋅·.\/]/u;
        const WORDS = new RegExp(WORD_CHAR.source + '+', 'gu');

        // Is (x, y) on the rendered text from start to end? Text layers can
        // return the nearest text even over blank space, so every word is
        // checked against where it is drawn. A few pixels of tolerance absorb
        // text-layer rounding; `exact` drops it when choosing between neighbours.
        const isUnder = (node, start, end, exact) => {
            const padX = exact ? 0 : 3, padY = exact ? 0 : 4;
            try {
                const range = doc.createRange();
                range.setStart(node, start);
                range.setEnd(node, end);
                for (const r of range.getClientRects()) {
                    if (x >= r.left - padX && x <= r.right + padX && y >= r.top - padY && y <= r.bottom + padY) return true;
                }
            } catch (e) {}
            return false;
        };
        const explained = t => !!this._lookupHover(t) || !!this._lookupDatabaseLinks(t);
        // The word around a character offset in a text node.
        const wordAt = (node, offset) => {
            const text = node.nodeValue || '';
            let start = Math.max(0, Math.min(offset, text.length)), end = start;
            while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
            while (end < text.length && WORD_CHAR.test(text[end])) end++;
            const word = text.slice(start, end);
            if (!word || !isUnder(node, start, end)) return '';
            if (word.includes('/') && !explained(word)) {
                const at = Math.min(Math.max(offset, start), end) - start;
                const from = at > 0 ? word.lastIndexOf('/', at - 1) + 1 : 0;
                const to = word.indexOf('/', at);
                const part = word.slice(from, to < 0 ? word.length : to);
                if (part) return part;
            }
            return word;
        };

        // The caret position under the pointer: the usual case.
        try {
            const pos = doc.caretPositionFromPoint ? doc.caretPositionFromPoint(x, y) : null;
            const node = pos ? pos.offsetNode : null;
            if (node && node.nodeType === 3) {
                const word = wordAt(node, pos.offset);
                if (word) return word;
            }
        } catch (e) {}

        // Something laid over the words hides them from the caret: in Reading
        // Mode (and EPUB and snapshot views) each highlight is a clickable box
        // over its text. Then the word is found by position, in the text of
        // the elements under the pointer, topmost first.
        try {
            for (const el of doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : []) {
                if (el.closest && el.closest('#abbreviation-helper-tooltip')) continue;
                for (const node of el.childNodes || []) {
                    if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
                    if (!isUnder(node, 0, node.nodeValue.length, true)) continue;
                    WORDS.lastIndex = 0;
                    let m;
                    while ((m = WORDS.exec(node.nodeValue))) {
                        if (!isUnder(node, m.index, m.index + m[0].length, true)) continue;
                        let offset = m.index;
                        for (let i = m.index; i < m.index + m[0].length; i++) {
                            if (isUnder(node, i, i + 1, true)) { offset = i; break; }
                        }
                        return wordAt(node, offset);
                    }
                }
            }
        } catch (e) {}
        return '';
    },

    /* ---- The three tooltips: one look, one way of choosing --------------
     * Meanings, database links and where a word is used are drawn alike: a
     * heading (the word in bold, a dash, what the tooltip says about it),
     * quieter lines under it, and, when there is something to choose,
     * numbered choices. Every choice is taken the same way: click it, or
     * press its number (1-9, then 0). Tooltips shown at the same moment
     * (sharing a key, or needing none) are one tooltip, in parts. */

    /** Empty the tooltip and write its heading: "word — says". */
    _startTooltip(doc, word, says) {
        const tip = this._ensureHoverTooltip(doc);
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        this.activeChoices = [];
        // Each part is built before it goes into the tooltip.
        const head = doc.createElement('div');
        const strong = doc.createElement('strong');
        strong.textContent = String(word || '');
        head.appendChild(strong);
        head.appendChild(doc.createTextNode(' — ' + says));
        tip.appendChild(head);
        return tip;
    },

    /** A quieter line: where a meaning comes from, a count, a group, a hint. */
    _addNote(doc, tip, text) {
        const div = doc.createElement('div');
        div.textContent = text;
        Object.assign(div.style, { fontSize: '0.85em', opacity: '0.7', marginTop: '3px' });
        return tip.appendChild(div);
    },

    /**
     * Numbered choices, each { label: text or nodes, choose(), href? }.
     * `inline` sets short labels side by side (database names); otherwise
     * each takes a line (a sentence of the paper). Numbers run on across the
     * lists of one tooltip. The keys reach ten, in the order of the number
     * row (1 to 9, then 0); a click reaches every one.
     */
    _addChoices(doc, tip, items, inline) {
        const light = this.tooltipTheme === 'light';
        const accent = light ? '#0b5fbf' : '#9ecbff';
        const hover = light ? 'rgba(11, 95, 191, 0.10)' : 'rgba(158, 203, 255, 0.16)';
        const box = doc.createElement('div');
        for (const item of items) {
            const n = this.activeChoices.push(item.choose);
            const el = doc.createElement(item.href ? 'a' : 'div');
            if (item.href) { el.href = item.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
            Object.assign(el.style, {
                display: inline ? 'inline-block' : 'block', margin: inline ? '1px 4px 1px 0' : '2px 0',
                padding: '1px 4px', borderRadius: '4px', cursor: 'pointer', color: 'inherit', textDecoration: 'none'
            });
            // A line that wraps continues under the text, not under its number.
            if (!inline) Object.assign(el.style, { paddingLeft: 'calc(4px + 1.05em)', textIndent: '-1.05em' });
            const badge = el.appendChild(doc.createElement('span'));
            badge.textContent = n <= 9 ? String(n) : n === 10 ? '0' : '·';
            Object.assign(badge.style, { color: accent, fontWeight: '600', marginRight: '0.45em' });
            for (const part of [].concat(item.label)) {
                el.appendChild(typeof part === 'string' ? doc.createTextNode(part) : part);
            }
            el.addEventListener('mouseenter', () => { el.style.background = hover; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
            el.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                item.choose();
            });
            box.appendChild(el);
        }
        return tip.appendChild(box);
    },

    /** Say how to choose, and let the tooltip be clicked and stay put. */
    _finishChoices(doc, tip) {
        this._addNote(doc, tip, 'Click one, or press its number.');
        tip.dataset.abbreviationHelperInteractive = 'true';
        tip.style.pointerEvents = 'auto';
        this.hoverInteractiveTooltip = true;
    },

    /** A tooltip with nothing to choose lets the mouse through to the page. */
    _finishPlain(tip) {
        tip.dataset.abbreviationHelperInteractive = 'false';
        tip.style.pointerEvents = 'none';
        this.hoverInteractiveTooltip = false;
    },

    /**
     * Database links as one row of choices, in the order of their groups.
     * The group names stay in the settings: in the tooltip, a database's
     * name says what it holds.
     */
    _addLinkGroups(doc, tip, groups) {
        this._addChoices(doc, tip, [].concat(...groups.map(g => g.links)).map(link => ({
            label: link.label, href: link.url, choose: () => this._openExternalURL(link.url)
        })), true);
    },

    /** A thin line between two parts of a tooltip. */
    _addDivider(doc, tip) {
        const line = doc.createElement('div');
        Object.assign(line.style, {
            height: '0', margin: '6px 0 4px', borderTop: '1px solid currentColor', opacity: '0.2'
        });
        return tip.appendChild(line);
    },

    /**
     * The tooltip for a word, with whichever of its three parts are shown,
     * always in this order and each set off from the one before by a line:
     *   1. the meaning, in the heading, and where it comes from under it;
     *   2. database links, one numbered row;
     *   3. where the word is used, one numbered line per use.
     * Numbers run on from one part to the next, so each choice has its own.
     * parts: { word, meaning: { term, certainty }, links: groups,
     *          uses: a findUses result, usesWord: the word looked up }.
     */
    _showTooltip(doc, x, y, parts) {
        const { word, meaning, uses } = parts;
        const links = (parts.links || []).filter(g => g && g.links && g.links.length);
        const shown = meaning ? this._meaningAndOrigin(meaning.term, meaning.certainty) : null;
        const says = shown ? shown.meaning
            : links.length && uses ? 'look it up, or see where it is used'
            : links.length ? 'look it up in a database'
            : 'where it is used';
        const tip = this._startTooltip(doc, word, says);
        if (shown && this.showMeaningSource) this._addNote(doc, tip, shown.origin);
        let above = !!shown;
        if (links.length) {
            if (above) this._addDivider(doc, tip);
            this._addLinkGroups(doc, tip, links);
            above = true;
        }
        if (uses) {
            if (above) this._addDivider(doc, tip);
            this._addUses(doc, tip, uses, parts.usesWord || word, word);
        }
        if (this.activeChoices.length) this._finishChoices(doc, tip);
        else this._finishPlain(tip);
        this._positionHoverTooltip(doc, tip, x, y);
    },


    // The note detection appends to every meaning the paper does not confirm:
    // "... (common term; not explicitly defined in this paper)".
    NOTE_RE: /^(.*?)\s+\(((?:probable meaning|possible meanings from|from another paper|from \d+ other papers|common term|common possible meanings)[^()]*)\)$/,

    /** A meaning and the note on where it comes from ('' when it has none). */
    _splitNote(term) {
        const text = String(term || '');
        const m = this.NOTE_RE.exec(text);
        return m ? { meaning: m[1], note: m[2] } : { meaning: text, note: '' };
    },

    /**
     * The meaning to show and the line under it saying where it comes from:
     * the note, when there is one; otherwise the user's own definition or one
     * the paper gives.
     */
    _meaningAndOrigin(term, certainty) {
        if (certainty === 'user') return { meaning: String(term || ''), origin: 'Your own definition' };
        const { meaning, note } = this._splitNote(term);
        if (note) return { meaning, origin: note.charAt(0).toUpperCase() + note.slice(1) };
        return { meaning, origin: 'Defined in this paper' };
    },


    /* ---- Where a word is used ------------------------------------------- */

    /**
     * The first uses of a word in the paper on screen (tooltip 3), as
     * findUses reports them. The paper's text is normally cached from the
     * scan; if not, it is read and the tooltip drawn again once it is there.
     * Null when there is nothing to show yet.
     */
    _usesOf(word, state) {
        const itemID = this.activeHoverItemID;
        if (!word || itemID == null) return null;
        const text = this.textCache.get(itemID);
        if (typeof text !== 'string') {
            this._readTextThenRedraw(itemID, state);
            return null;
        }
        // The last result is kept: pointing at the same word again is free.
        const memo = this._usesMemo;
        const result = memo && memo.itemID === itemID && memo.word === word && memo.count === this.usesCount
            ? memo.result : findUses(text, word, Math.max(1, this.usesCount), 15);
        this._usesMemo = { itemID, word, count: this.usesCount, result };
        return result;
    },

    /** Read a paper's text again (it was evicted), then redraw if the pointer stayed. */
    _readTextThenRedraw(itemID, state) {
        if (this._readingText) return;
        this._readingText = Zotero.Items.getAsync(itemID)
            .then(item => this._textForItem(item))
            .then(() => { if (!this._stopped && this.lastHoverState === state) this._renderHoverFromState(state); })
            .catch(e => this.log('Could not read the text for where a word is used: ' + e))
            .finally(() => { this._readingText = null; });
    },

    /**
     * Tooltip 3's part: how often the word is used, then its first uses,
     * each a choice that goes there. The word is named when it is not the
     * one in the heading (the uses of EV under "EVs", or under a database
     * phrase).
     */
    _addUses(doc, tip, result, word, heading) {
        const n = result.total, shown = result.uses.length;
        const count = !n ? 'Not found in the text of this PDF.'
            : 'Used ' + n + (n === 1 ? ' time' : ' times') + (shown < n ? '; the first ' + shown + ':' : ':');
        this._addNote(doc, tip, word === heading ? count : word + ': ' + count.charAt(0).toLowerCase() + count.slice(1));
        if (!shown) return;
        this._addChoices(doc, tip, result.uses.map(use => {
            const page = doc.createElement('span');
            page.textContent = 'p. ' + (use.pageIndex + 1) + ' · ';
            page.style.opacity = '0.7';
            const match = doc.createElement('strong');
            match.textContent = use.match;
            return {
                label: [page, use.before, match, use.after],
                choose: () => this._jumpToUse(doc, use, word).catch(e => this.log('Could not go to the use: ' + e))
            };
        }), false);
    },

    /**
     * Go to a use: the reader turns to its page, keeping the place you came
     * from for its Back button, then the word is marked for a moment.
     */
    async _jumpToUse(doc, use, word) {
        const reader = this._activeReader();
        this._forgetHover(this.hoverPinnedDoc || doc);
        if (!reader || typeof reader.navigate !== 'function') return;
        await reader.navigate({ pageIndex: use.pageIndex });
        await this._markUse(doc, use, word);
    },

    /**
     * Mark a use on its page for a moment and bring it to the middle of the
     * view, in the PDF view. The page may still be drawing after the jump, so
     * its text is waited for, up to 2 s. Reading Mode has no pages to search,
     * so there the jump to the page is all.
     */
    async _markUse(doc, use, word) {
        const selector = '.page[data-page-number="' + (use.pageIndex + 1) + '"] .textLayer';
        let layer = null;
        for (let i = 0; i < 20 && !this._stopped; i++) {
            try { layer = doc.querySelector(selector); } catch (e) { return; }
            if (layer && layer.textContent.trim()) break;
            layer = null;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!layer || this._stopped) return;
        // The use's place among the word's uses on the page, counted again in
        // the pieces of text the page is drawn with.
        const re = usesPattern(word);
        let seen = 0;
        const walker = doc.createTreeWalker(layer, 4 /* NodeFilter.SHOW_TEXT */);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(node.nodeValue))) {
                if (seen++ < use.nthOnPage) continue;
                const range = doc.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                this._flashRange(doc, layer, range);
                return;
            }
        }
    },

    // The colour Zotero's reader gives the current match of a search
    // (Ctrl/Cmd+F), so a use you went to looks like a word you searched for:
    // green, stronger on a dark page. From zotero/reader, src/common/defines.js
    // (FIND_RESULT_COLOR_CURRENT_LIGHT and _DARK).
    FOUND_COLOR_LIGHT: 'rgba(0, 100, 0, 0.3)',
    FOUND_COLOR_DARK: 'rgba(0, 100, 0, 0.6)',

    /**
     * A short-lived mark over a range of a page's text, drawn as the reader
     * draws a search match: the match's own boxes, in its colour, with its
     * corners (5 device pixels).
     */
    _flashRange(doc, layer, range) {
        const page = (layer.closest && layer.closest('.page')) || layer.parentNode;
        const box = page.getBoundingClientRect();
        const color = this._pageIsDark(doc) ? this.FOUND_COLOR_DARK : this.FOUND_COLOR_LIGHT;
        let ratio = 1;
        try { ratio = (doc.defaultView && doc.defaultView.devicePixelRatio) || 1; } catch (e) {}
        const radius = Math.max(1, Math.round(5 / ratio)) + 'px';
        const marks = [];
        for (const r of range.getClientRects()) {
            const mark = doc.createElement('div');
            Object.assign(mark.style, {
                position: 'absolute', left: (r.left - box.left) + 'px', top: (r.top - box.top) + 'px',
                width: r.width + 'px', height: r.height + 'px', borderRadius: radius,
                background: color, pointerEvents: 'none', zIndex: '3', transition: 'opacity 0.6s'
            });
            marks.push(page.appendChild(mark));
        }
        const holder = range.startContainer.parentElement;
        if (holder && holder.scrollIntoView) holder.scrollIntoView({ block: 'center', inline: 'nearest' });
        setTimeout(() => { for (const m of marks) m.style.opacity = '0'; }, 1400);
        setTimeout(() => { for (const m of marks) if (m.parentNode) m.parentNode.removeChild(m); }, 2100);
    },

    /**
     * Is the page shown dark? The reader decides it the same way, from the
     * background of the page theme in use, which it puts on the page as
     * --background-color (a dark theme, or dark mode for PDFs). Without one,
     * as before page themes, the page is light.
     */
    _pageIsDark(doc) {
        try {
            const root = doc.documentElement;
            const value = doc.defaultView.getComputedStyle(root).getPropertyValue('--background-color').trim();
            let rgb = null;
            const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
            if (hex) {
                const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
                rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
            } else {
                const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
                if (m) rgb = m.slice(1, 4).map(Number);
            }
            if (!rgb) return !!(root.dataset && root.dataset.colorScheme === 'dark');
            // Relative luminance, as the reader computes it.
            const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.3;
        } catch (e) {
            return false;
        }
    },

    /* ---- The tooltip element, clicks and keys ---------------------------
     * One tooltip element per reader page, shown, moved and hidden here.
     * Clicks outside a tooltip with choices close it; Escape closes it; the
     * number keys choose; modifier keys bring tooltips up and take them away
     * (see _onModifierKey). */

    _ensureHoverTooltip(doc) {
        let tip = doc.getElementById('abbreviation-helper-tooltip');
        // A tooltip made by another copy of the plugin (an earlier version
        // still open in a reader tab after an update) carries that copy's
        // event handlers and look, so it is replaced rather than reused.
        if (tip && tip.dataset && tip.dataset.abbreviationHelperOwner !== this._instanceToken) {
            if (tip.parentNode) tip.parentNode.removeChild(tip);
            tip = null;
        }
        if (!tip) {
            tip = doc.createElement('div');
            tip.id = 'abbreviation-helper-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.style.position = 'fixed';
            tip.style.zIndex = '2147483647';
            tip.style.maxWidth = '480px';
            tip.style.padding = '6px 8px';
            tip.style.borderRadius = '6px';
            const light = this.tooltipTheme === 'light';
            tip.style.background = light ? 'rgba(252, 252, 252, 0.98)' : 'rgba(32, 33, 36, 0.96)';
            tip.style.color = light ? '#1a1a1a' : 'white';
            tip.style.border = light ? '1px solid rgba(0,0,0,.18)' : 'none';
            // Font stack covers macOS, Windows and the common Linux defaults.
            tip.style.font = Number(this.tooltipFontSize || 12) + 'px -apple-system, BlinkMacSystemFont, '
                + '"Segoe UI", Cantarell, Ubuntu, "Liberation Sans", "DejaVu Sans", sans-serif';
            tip.style.lineHeight = '1.35';
            tip.style.boxShadow = '0 2px 8px rgba(0,0,0,.35)';
            // The mouse passes through by default. A tooltip with choices
            // switches this to 'auto' when shown (see _finishChoices)
            // so its links can be clicked; the handlers below then keep it
            // open while the pointer is over it.
            tip.style.pointerEvents = 'none';
            tip.style.whiteSpace = 'normal';
            tip.dataset.abbreviationHelperOwner = this._instanceToken;
            tip.addEventListener('mouseenter', () => {
                this._cancelHoverHide();
            });
            tip.addEventListener('mouseleave', () => {
                this._pointerOnTooltip = false;
                this._scheduleHoverHide(doc, 250);
            });
            doc.body.appendChild(tip);
        }
        return tip;
    },

    _positionHoverTooltip(doc, tip, x, y) {
        this._cancelHoverHide();
        this.hoverPinnedDoc = doc || null;
        tip.style.display = 'block';
        const margin = 14;
        let left = x + margin;
        let top = y + margin;
        const vw = doc.defaultView ? doc.defaultView.innerWidth : 1000;
        const vh = doc.defaultView ? doc.defaultView.innerHeight : 800;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        const rect = tip.getBoundingClientRect();
        if (rect.right > vw - 8) left = Math.max(8, x - rect.width - margin);
        if (rect.bottom > vh - 8) top = Math.max(8, y - rect.height - margin);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        // Remembered so the tooltip can follow the pointer without measuring
        // it again, and so the way to a tooltip with links can be recognised.
        this._tipBox = { doc, left, top, width: rect.width, height: rect.height };
        this.hoverAnchor = { x, y };
    },

    /**
     * Follow the pointer across the same word, using the size measured when
     * the tooltip was drawn, so no layout has to be recalculated.
     */
    _moveHoverTooltip(doc, x, y) {
        const b = this._tipBox;
        if (!b || b.doc !== doc) return;
        let tip = null;
        try { tip = doc.getElementById('abbreviation-helper-tooltip'); } catch (e) {}
        if (!tip) return;
        const margin = 14;
        const vw = doc.defaultView ? doc.defaultView.innerWidth : 1000;
        const vh = doc.defaultView ? doc.defaultView.innerHeight : 800;
        let left = x + margin;
        let top = y + margin;
        if (left + b.width > vw - 8) left = Math.max(8, x - b.width - margin);
        if (top + b.height > vh - 8) top = Math.max(8, y - b.height - margin);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        b.left = left;
        b.top = top;
        this.hoverAnchor = { x, y };
    },

    _isHoverTooltipVisible(doc) {
        try {
            const tip = doc && doc.getElementById ? doc.getElementById('abbreviation-helper-tooltip') : null;
            return !!(tip && tip.style.display !== 'none');
        } catch (e) {
            return false;
        }
    },

    _onReaderClick(doc, event) {
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            if (tip && event.target && tip.contains(event.target)) {
                // Allow database links to receive the click.  Do not hide here;
                // the link handler may call Zotero.launchURL.
                this._cancelHoverHide();
                return;
            }
        } catch (e) {}
        // Clicking anywhere else, in this page or another, dismisses a tooltip
        // with links, so it cannot linger; a plain one follows the pointer.
        if (this.hoverInteractiveTooltip) this._forgetHover(this.hoverPinnedDoc || doc);
    },

    // The modifier each key sets, named as the settings name them.
    MODIFIER_KEYS: { Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'meta' },

    _onReaderKeyDown(doc, event) {
        // Keys that are part of composing a character (an input method, a
        // dead key) are not shortcuts.
        if (!event || event.isComposing) return;
        if (this.MODIFIER_KEYS[event.key]) {
            this._onModifierKey(doc, event, true);
            return;
        }
        // The tooltip may be in another page of the reader than the one with
        // the keyboard focus (the PDF view and its Reading Mode).
        const tipDoc = this.hoverPinnedDoc || doc;
        if (event.key === 'Escape') {
            this._forgetHover(tipDoc);
            return;
        }
        this._chooseByNumber(event);
    },

    /**
     * 1-9 and 0 (the tenth) choose from a tooltip with choices (database
     * links, uses); a tooltip with only a meaning leaves the keys alone.
     * This is the reliable way to choose when the reader makes clicking
     * hard. Called from the main window first and from the page, so a
     * number already taken (its default prevented) is left alone.
     */
    _chooseByNumber(event) {
        if (!event || event.defaultPrevented || event.isComposing) return;
        // Keys typed into a text field (an annotation comment, the search
        // box) are never taken.
        if (this._typingInto(event.target)) return;
        const tipDoc = this.hoverPinnedDoc;
        if (!this.hoverInteractiveTooltip || !tipDoc || !this._isHoverTooltipVisible(tipDoc)) return;
        // The physical key counts, not the character it types, so the
        // shortcut works on every layout: with Shift held, the "1" key types
        // "!" on a German keyboard, and without it "&" on a French one.
        const digit = /^[0-9]$/.test(String(event.key || '')) ? event.key
            : (/^(?:Digit|Numpad)([0-9])$/.exec(String(event.code || '')) || [])[1];
        if (!digit || !this._numberKeyIsOurs(event)) return;

        const choose = this.activeChoices[digit === '0' ? 9 : Number(digit) - 1];
        if (!choose) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        choose();
    },

    /**
     * May a number pressed with these modifiers choose? With none, yes, and
     * with Shift, which some layouts need to type a digit at all (French).
     * With Ctrl, Cmd or Alt, only while that is the key showing the tooltip:
     * the number is then meant for it, and taken before Zotero switches tabs
     * (Ctrl/Cmd+1-9) or the reader its tools (Alt+1-8). Any other such
     * combination stays Zotero's. Outside macOS, AltGr (reported as Ctrl
     * and Alt together on Windows) types a character, "@" with 0 on a
     * French keyboard, and the Windows or Super key is never ours.
     */
    _numberKeyIsOurs(event) {
        if (!this._isMac() && typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) return false;
        const held = [];
        if (event.ctrlKey || (event.metaKey && this._isMac())) held.push('ctrl');
        else if (event.metaKey) return false;
        if (event.altKey) held.push('alt');
        const showing = this._keysShowing();
        return held.every(key => showing.includes(key));
    },

    /** The keys held now that show a tooltip switched on. */
    _keysShowing() {
        return [[this.hoverEnabled, this.tooltipModifier], [this.databaseLinksEnabled, this.databaseLinksModifier],
            [this.usesEnabled, this.usesModifier]]
            .filter(([on, key]) => on && key !== 'none' && this._modifierSatisfied(key))
            .map(([, key]) => key);
    },

    /** Is the key going into a text field or an editable element? */
    _typingInto(target) {
        try {
            const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
            return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(target && target.isContentEditable);
        } catch (e) {
            return false;
        }
    },

    _onReaderKeyUp(doc, event) {
        if (!event || !this.MODIFIER_KEYS[event.key]) return;
        // On Windows and Linux, letting go of Alt on its own moves the
        // keyboard to the menu bar, which would then take the number pressed
        // next. Not when Alt was held for a tooltip still on screen.
        if (event.key === 'Alt' && this._tooltipShownWith('alt') && event.preventDefault) event.preventDefault();
        this._onModifierKey(doc, event, false);
    },

    /** Is a tooltip on screen, and is one of those switched on shown with this key? */
    _tooltipShownWith(key) {
        const uses = (this.hoverEnabled && this.tooltipModifier === key)
            || (this.databaseLinksEnabled && this.databaseLinksModifier === key)
            || (this.usesEnabled && this.usesModifier === key);
        return uses && !!this.hoverPinnedDoc && this._isHoverTooltipVisible(this.hoverPinnedDoc);
    },

    /**
     * A modifier went down or up: redraw the tooltip, whose kind depends on
     * it (database links while Shift is held, say). Only a real change
     * redraws it, so a held key, which repeats its key-down, does not rebuild
     * the tooltip again and again. A tooltip the pointer is on stays as it
     * is, so its choices can still be made after the key is let go.
     */
    _onModifierKey(doc, event, down) {
        if (this._stopped || !this._anyTooltipOn()) return;
        // Shift pressed for a capital in an annotation, a note or a search
        // box is typing, not a request for a tooltip at the pointer. Letting
        // go is always followed, so nothing stays shown.
        if (down && this._typingInto(event.target)) return;
        const before = JSON.stringify(this.modifierState);
        this._updateModifierState(event);
        // The key itself is not reliably reflected in the event's flags yet.
        this.modifierState[this.MODIFIER_KEYS[event.key]] = down;
        if (JSON.stringify(this.modifierState) !== before && !this._pointerOnTooltip) {
            this._refreshHoverFromLastState(doc || this.hoverPinnedDoc);
        }
    },

    _onReaderBlur(doc) {
        const before = JSON.stringify(this.modifierState);
        this.modifierState = { shift: false, ctrl: false, alt: false, meta: false };
        if (JSON.stringify(this.modifierState) !== before && !this._pointerOnTooltip) this._refreshHoverFromLastState(doc);
    },

    _openExternalURL(url) {
        try {
            if (typeof Zotero !== 'undefined' && Zotero.launchURL) {
                Zotero.launchURL(url);
                return;
            }
        } catch (e) {}
        try {
            if (this.hoverPinnedDoc && this.hoverPinnedDoc.defaultView) {
                this.hoverPinnedDoc.defaultView.open(url, '_blank', 'noopener');
            }
        } catch (e) {}
    },

    _scheduleHoverHide(doc, delay) {
        this._cancelHoverHide();
        this.hoverHideTimer = setTimeout(() => {
            this.hoverHideTimer = null;
            this._hideHoverTooltip(doc);
        }, delay || 500);
    },

    _cancelHoverHide() {
        if (this.hoverHideTimer) {
            clearTimeout(this.hoverHideTimer);
            this.hoverHideTimer = null;
        }
    },

    /** Drop the tooltip element so appearance changes take effect next hover. */
    _resetHoverTooltips() {
        for (const rec of this.hoverDocs || []) {
            try {
                const tip = rec.doc.getElementById('abbreviation-helper-tooltip');
                if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
            } catch (e) {}
        }
    },

    _hideHoverTooltip(doc) {
        this._cancelHoverHide();
        this._clearCorridor();
        this._pointerOnTooltip = false;
        this.hoverPinnedDoc = null;
        this.hoverInteractiveTooltip = false;
        this.activeChoices = [];
        this._renderedSig = null;
        this.hoverAnchor = null;
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            if (tip) {
                tip.style.display = 'none';
                tip.style.pointerEvents = 'none';
                tip.dataset.abbreviationHelperInteractive = 'false';
            }
        } catch (e) {}
    }
};