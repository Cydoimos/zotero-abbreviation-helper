# Labelling rules

Goal: for each paper, list every abbreviation a reader might hover, with the
meaning the paper intends. Labels are complete, so both missed abbreviations
and wrong extra ones can be counted automatically.

## What to label

1. **Defined in the paper.** The paper spells out the long form somewhere a
   reader would hover: main text, methods (also methods placed after the
   references, such as Cell's STAR Methods), figure and table captions,
   footnotes, or an abbreviations list or glossary table. Record how it is
   defined:
   - `paren`: long form (SF), or long form [SF]
   - `reverse`: SF (long form)
   - `inside`: (long form, SF)
   - `list`: an abbreviations list or glossary table
   - `phrase`: "hereafter SF", "abbreviated as SF", "referred to as SF"
   - `other`: anything else; say what in a note
2. **Used but not defined.** Used at least twice and never spelled out, with
   a standard meaning in the field (DNA, PCR, ATP). Scored separately, as a
   measure of the built-in glossary.

## What not to label

These go in the paper's `ignore` list: the plugin may show them or not, with
no penalty either way.

Always ignored:

- Single letters, panel labels and Roman numerals (A, B, II).
- Units, chemical formulas, element symbols and mathematical symbols (kDa,
  S/m, NaCl, Mg2+, γ0), even when the paper spells them out.
- Anything appearing only in the reference list, author affiliations,
  funding, acknowledgements, author contributions or competing interests.
- Grant, accession and catalogue numbers, licence names (CC BY), file
  formats, and running headers or footers.
- Countries, states and cities (UK, USA, NY), and authors' initials.

Ignored unless the paper spells them out (then they are labelled):

- Statistics (SD, CI, p).
- Supplier, instrument, software, model and brand names (NEB, Bio-Rad).
- Gene, protein, strain and cell-line names used as names (TP53, HeLa, BL21).

## The meaning

- Write the long form as the paper writes it, without a leading "the" or "a".
  Scoring ignores case, hyphens versus spaces, and a plural -s.
- The long form is the words the short form stands for: "active pulmonary
  tuberculosis (TB)" gives `tuberculosis`. A longer reading that is still
  right goes in `alt` and also counts as correct.
- A defined short form is labelled even if the definition is its only
  appearance. A short form that is never defined and appears only once is not
  labelled; it goes in `ignore`.
- Singular and plural are one entry, written as at the definition (EVs).
- Record the true meaning even when the extracted text is damaged (a lost
  hyphen, a page footer in the middle of the long form).
- If a short form is defined twice with different meanings, the first is the
  answer and the second goes in `alt`.
- If the intended meaning cannot be told from the paper, mark the entry
  `"unclear": true`; it is then left out of the scores.

## Scoring

- **Found**: the plugin lists the short form, or its singular or plural.
- **Correct**: the meaning matches after the normalisation above.
- **Partial**: the right concept with words missing or extra words attached.
- **Wrong**: anything else.
- **False positive**: an output that is neither labelled nor in `ignore`.

## How the labels are made

1. Blind: an over-inclusive scanner lists every candidate (brackets, lists,
   "hereafter", repeated capitalised tokens) and each is read in context,
   without looking at the plugin's output.
2. Then the plugin is run and every disagreement is re-checked against the
   text. Each label changed at this step is logged with its reason.
3. A person checks a random 10 % of the test papers by hand, which estimates
   the labelling error rate.
4. The test set is scored only before a release. Individual test errors are
   never looked at while changing the detector.

## File format

One file per paper in `labels/<set>/`, named after the DOI:

```json
{
  "doi": "10.1016/j.isci.2025.112363",
  "title": "…",
  "defined": [
    { "sf": "ROS", "lf": "reactive oxygen species", "how": "paren" }
  ],
  "undefined": [
    { "sf": "DNA", "lf": "deoxyribonucleic acid" }
  ],
  "ignore": ["HeLa", "Bio-Rad"]
}
```
