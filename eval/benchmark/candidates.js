'use strict';
/*
 * List every place in a paper where an abbreviation might be defined or used,
 * for labelling by hand. Deliberately over-inclusive and independent of the
 * plugin's own detection code, so the labels are not shaped by what the
 * plugin can already do.
 *
 *   node candidates.js <paper.txt>
 *
 * Sections:
 *   LISTS     "Abbreviations" lists and glossary headers, with what follows
 *   PHRASES   "hereafter X", "abbreviated as X", "referred to as X", …
 *   BRACKETS  every bracket holding something that looks like a short form,
 *             or a short form directly before a bracket (reverse definitions)
 *   TOKENS    every abbreviation-like token used twice or more that none of
 *             the above showed, with its count and first use
 *
 * Each hit shows its position in the text as a percentage, so definitions
 * after the reference list (Cell's STAR Methods) can be told apart.
 */
const fs = require('fs');

const raw = fs.readFileSync(process.argv[2], 'utf8');
const text = raw.replace(/\f/g, ' ').replace(/­/g, '').replace(/\s+/g, ' ');
const N = text.length;
const pct = (i) => String(Math.round(100 * i / N)).padStart(3) + '%';
const clip = (s) => s.replace(/\s+/g, ' ').trim();
const before = (i, n) => clip(text.slice(Math.max(0, i - n), i));

// Something that could be a short form: 2–20 characters, at most two words,
// with a letter and a capital or digit, and not a citation, figure reference
// or quantity.
const NOT_SF = /^(?:fig(?:ure)?s?\.?|tables?|refs?\.?|eqs?\.?|e\.g\.?|i\.e\.?|cf\.?|see|vs\.?|et al\.?|supplementary|extended data|movie|video|appendix|step|panel)\b/i;
function sfLike(s) {
    s = s.trim();
    if (s.length < 2 || s.length > 20) return false;
    if (s.split(/\s+/).length > 2) return false;
    if (!/[A-Za-zΑ-ω]/.test(s) || !/[A-Z0-9Α-Ω]/.test(s)) return false;
    if (NOT_SF.test(s)) return false;
    if (/^[\d\s,.;:–—\-]+$/.test(s)) return false;                              // citations, ranges
    if (/^[A-Z]$/.test(s) || /^[A-Z]\d?[a-z]?$/.test(s)) return false;            // panel labels
    if (/^\d+(?:\.\d+)?\s*(?:[a-zµμ%°]+|[A-Z][a-z]?)$/.test(s)) return false;     // quantities
    if (/^p\s*[<>=]/.test(s) || /^n\s*=/.test(s)) return false;                  // statistics
    if (/^(?:19|20)\d\d[a-z]?$/.test(s)) return false;                           // years
    return true;
}

const seen = new Set();
const out = [];

// ---- LISTS --------------------------------------------------------------
out.push('== LISTS');
const listRe = /\b(?:List of abbreviations|Abbreviations?(?: used)?|Glossary|Nomenclature|Acronyms)\b\s*[:.\-–—]?/g;
let m, lists = 0;
while ((m = listRe.exec(text))) {
    const after = text.slice(m.index, m.index + 1400);
    // A list header is followed by short-form-like entries, not running prose.
    const firstWords = after.slice(m[0].length, m[0].length + 60);
    if (!/^\s*(?:the\s+)?(?:abbreviations?\s+used\s+are\s*:?\s*)?[A-Za-z0-9Α-ω][^\s,:;]{0,20}\s*[,:;=\-–—\s]/i.test(firstWords)) continue;
    out.push(pct(m.index) + ' ' + clip(after));
    lists++;
}
if (!lists) out.push('(none)');

// ---- PHRASES ------------------------------------------------------------
out.push('\n== PHRASES');
const phraseRe = /\b(hereafter|henceforth|abbreviated (?:as|to)|referred to as|termed|denoted(?: as| by)?|known as|designated(?: as)?|called)\s+(?:the\s+|as\s+)?["“'‘(]?([A-Za-z0-9Α-ω][\w\-\/Α-ω]{0,19})/gi;
let phrases = 0;
while ((m = phraseRe.exec(text))) {
    if (!sfLike(m[2])) continue;
    out.push(pct(m.index) + ' ' + m[2] + '  <<  ' + before(m.index, 110) + ' ⟨' + clip(text.slice(m.index, m.index + 40)) + '⟩');
    seen.add(m[2]);
    phrases++;
}
if (!phrases) out.push('(none)');

// ---- BRACKETS -----------------------------------------------------------
out.push('\n== BRACKETS  (first time each short form is seen; "×n" = further bracket uses)');
const bracketRe = /([A-Za-z0-9Α-ω][\w\-\/Α-ω.+]{0,19})?\s?[(\[]([^()\[\]]{1,140})[)\]]/g;
const firstAt = new Map(), more = new Map();
while ((m = bracketRe.exec(text))) {
    const inner = m[2];
    const parts = inner.split(/[;,]/).map(s => s.trim());
    const words = inner.trim().split(/\s+/).length;
    const keys = [];
    for (const p of parts) if (sfLike(p)) keys.push(p);
    // Reverse definition: a short form right before a bracket of words.
    const prev = m[1] && sfLike(m[1]) && words >= 2 && !keys.length ? m[1] : null;
    if (prev) keys.push('<' + prev + '>');
    if (!keys.length) continue;
    for (const k of keys) {
        const sf = k.replace(/^<|>$/g, '');
        if (firstAt.has(k)) { more.set(k, (more.get(k) || 0) + 1); continue; }
        firstAt.set(k, out.length);
        seen.add(sf);
        const ctx = prev && k.startsWith('<')
            ? before(m.index + (m[1] || '').length, 60) + ' ⟨' + clip(m[0]) + '⟩'
            : before(m.index + (m[1] ? m[1].length + 1 : 0), 120) + ' ⟨' + clip(text.slice(m.index + (m[1] ? m[1].length : 0), m.index + m[0].length)) + '⟩';
        out.push(pct(m.index) + ' ' + (prev && k.startsWith('<') ? 'REVERSE ' + sf : sf) + '  <<  ' + ctx);
    }
}
for (const [k, i] of firstAt) if (more.get(k)) out[i] += '  ×' + more.get(k);

// ---- TOKENS -------------------------------------------------------------
out.push('\n== TOKENS  (used ≥2 times, not shown above: count, token, first use)');
const tokRe = /(?<![\w\-])([A-Za-z0-9Α-ω][A-Za-z0-9\-\/Α-ω]{0,14}[A-Za-z0-9Α-ω])(?![\w\-])/g;
const counts = new Map(), first = new Map();
while ((m = tokRe.exec(text))) {
    const t = m[1];
    const caps = (t.match(/[A-ZΑ-Ω]/g) || []).length;
    const abbrevShape = caps >= 2 || (caps >= 1 && /\d/.test(t)) || /^[a-z]{1,3}[A-Z]/.test(t);
    if (!abbrevShape || !sfLike(t)) continue;
    if (/^[IVX]+$/.test(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!first.has(t)) first.set(t, m.index);
}
const rows = [...counts].filter(([t, c]) => c >= 2 && !seen.has(t) && !seen.has(t.replace(/s$/, '')) && !seen.has(t + 's'))
    .sort((a, b) => first.get(a[0]) - first.get(b[0]));
for (const [t, c] of rows) {
    const i = first.get(t);
    out.push(pct(i) + ' ' + String(c).padStart(3) + '× ' + t + '  << ' + before(i, 45) + ' ⟨' + t + '⟩ ' + clip(text.slice(i + t.length, i + t.length + 25)));
}
if (!rows.length) out.push('(none)');

console.log(out.join('\n'));
