# Abbreviation benchmark

Papers for measuring how well the plugin finds abbreviations and gets their
meaning right. Paper texts are never committed (they are copyrighted); this
folder holds only the paper lists, the export script and, later, the labels.

## The two sets

- **dev**: for working on the detector; measure on it as often as you like.
  It holds the 22 papers already labelled in `../gold-standard.json` (the
  detector was tuned on them) plus papers from your own library: about 15–20,
  at most 2 per journal, research articles and reviews mixed.
- **test**: 40 open-access papers drawn at random from 38 journals, 21
  publishers and fields from microbiology to physics, plus one medRxiv and one
  arXiv preprint. Measure on it only before a release, never while tuning, so
  the numbers stay honest. See `test-papers.csv`.

## Getting the texts (once)

1. In Zotero, create two collections: `Abbreviation benchmark - test` and
   `Abbreviation benchmark - dev`.
2. Select the test collection, click the magic wand (Add Item by Identifier),
   paste all of `test-identifiers.txt` and press Enter. Zotero adds the papers
   and their PDFs. Do the same for the dev collection with
   `dev-identifiers.txt`, then drag in your own dev papers.
3. Tools → Developer → Run JavaScript, paste `export-from-zotero.js`, keep
   "Run as async function" ticked, press Run. When it has finished, the result
   appears in the "Return value" box (if no collection matched, it lists your
   collection names). The texts are saved in
   `<Zotero data directory>/abbreviation-benchmark/` and the folder opens in the
   Finder. Papers without a PDF are listed; for those, right-click →
   Find Full Text (or download the PDF in your browser and drag it onto the
   paper), then run the script again.

The script only reads your library. The text it saves is exactly what the
plugin sees, from Zotero's own PDF worker, unlike the old `pdftotext` corpus.

## Files

| File | What it is |
|---|---|
| `test-identifiers.txt`, `dev-identifiers.txt` | One DOI or arXiv ID per line, to paste into Zotero |
| `test-papers.csv`, `dev-papers.csv` | The same papers with field, journal, year and title |
| `export-from-zotero.js` | Saves the papers' text from Zotero |
