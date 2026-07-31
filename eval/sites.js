'use strict';
/*
 * Compact, deliberately over-inclusive listing of possible definition sites,
 * for hand-labelling a gold standard. Independent of the plugin's logic.
 * Shows every "(TOKEN)" that could be a short form, with preceding context.
 */
const fs = require('fs');
const text = fs.readFileSync(process.argv[2], 'utf8').replace(/\s+/g, ' ');
const ctxLen = Number(process.argv[3] || 78);

const seen = new Set();
const re = /[\(\[]\s*([^()\[\]]{1,40}?)\s*[\)\]]/g;
let m, n = 0;
while ((m = re.exec(text))) {
  const inner = m[1].trim();
  if (!/[A-Za-z]/.test(inner)) continue;                    // must contain letters
  if (inner.split(/\s+/).length > 2) continue;              // short forms are 1-2 tokens
  if (!/[A-Z0-9]/.test(inner)) continue;                    // needs a capital or digit
  if (/^(?:Fig|Figure|Table|Ref|see|e\.?g|i\.?e|Supplementary|Movie|Eq|Video|Data|Extended)\b/i.test(inner)) continue;
  if (/^\d+(?:[-–,.]\s*\d+)*$/.test(inner)) continue;       // pure numbers/citations
  if (/^[A-Z]$/.test(inner)) continue;                      // single letters (panel labels)
  if (/^\d+\s*(?:h|min|s|nm|mM|µM|mg|mL|kDa|Da|%|°C|M|g)$/i.test(inner)) continue; // quantities
  const key = inner.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const before = text.slice(Math.max(0, m.index - ctxLen), m.index).trim();
  console.log(`(${inner})  <<  ${before}`);
  n++;
}
console.log(`\n[${n} unique candidate sites]`);
