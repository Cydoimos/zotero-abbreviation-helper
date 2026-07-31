'use strict';
/*
 * Independent candidate-site extractor for building a GOLD STANDARD by hand.
 *
 * Deliberately naive and unrelated to the plugin's detection logic: it simply
 * lists every place a human would look for an abbreviation definition, so the
 * gold standard is built by reading the paper, not by grading the plugin
 * against its own output.
 *
 * Usage: node extract-candidates.js <text-file>
 */
const fs = require('fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const text = raw.replace(/\s+/g, ' ');

console.log('===== FILE: ' + file + ' =====\n');

// 1) Explicit "Abbreviations:" blocks (raw, so paragraph structure is visible).
const abbrevBlocks = [...raw.matchAll(/Abbreviations?\s*[::]/gi)];
if (abbrevBlocks.length) {
  console.log('--- EXPLICIT ABBREVIATION SECTIONS ---');
  for (const m of abbrevBlocks) {
    console.log(JSON.stringify(raw.slice(m.index, m.index + 700)));
    console.log('');
  }
}

// 2) Every parenthetical/bracketed token that could be a short form, with the
//    preceding context window so the long form can be judged by eye.
console.log('--- PARENTHETICAL CANDIDATE SITES ---');
const seen = new Set();
const re = /[\(\[]\s*([^()\[\]]{1,60}?)\s*[\)\]]/g;
let m, n = 0;
while ((m = re.exec(text))) {
  const inner = m[1].trim();
  // Only consider chunks that plausibly contain a short form.
  if (!/[A-Za-z]/.test(inner)) continue;
  if (inner.split(/\s+/).length > 4) continue;
  if (!/[A-Z]/.test(inner)) continue;
  if (/^(?:Fig|Figure|Table|Ref|see|e\.g|i\.e)\b/i.test(inner)) continue;
  if (/^\d+(?:[-–,]\s*\d+)*$/.test(inner)) continue;
  const key = inner.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const before = text.slice(Math.max(0, m.index - 130), m.index).trim();
  console.log(`[${++n}] (${inner})`);
  console.log(`      ...${before}`);
  console.log('');
}
console.log('total unique candidate sites: ' + n);
