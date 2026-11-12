# Abbreviation Helper

A Zotero plugin that expands **acronyms, initialisms and other abbreviations** while you
read. It finds where a paper defines each short form and shows the meaning when you hover
over it — so you can skim a PDF without scrolling back to hunt for the first use.

![Hovering over "EV" in a paper shows "extracellular vesicles — defined in this paper"](docs/demo.gif)

<sub>Paper shown: Hinestrosa et al., *Commun. Med.* 2, 29 (2022), open access.</sub>

It can also offer database lookup links (gene, protein, cell line, chemical) for the
name under the pointer, and list where any word is used in the paper, so you can jump to
its first use.

Works on **macOS, Windows and Linux**. Requires **Zotero 7 or newer**
(tested on Zotero 10.0.1).

---

## Install

1. Download `abbreviation-helper-<version>.xpi` from the
   [latest release](https://github.com/Cydoimos/zotero-abbreviation-helper/releases/latest).
2. In Zotero: **Tools → Plugins → gear icon → Install Plugin From File…**
3. Select the `.xpi`. No restart needed.

> **Using Firefox?** Right-click the download link and choose **Save Link As…**
> Firefox recognises the `.xpi` extension and tries to install the file as a
> *Firefox* plugin, which then fails. Saving it to disk first avoids this.
> Other browsers download it normally, and Zotero's own automatic updates are
> unaffected.

## Use

Open a PDF in the Zotero reader. The plugin scans it in the background. Only the PDF in
the reader tab you are looking at is scanned, and switching tabs switches the meanings
with it. Everything also works in Zotero 10's Reading Mode for PDFs.

The plugin shows three kinds of tooltips: **meanings**, **database links** and **where a
word is used**. Only meanings are on at first; switch the others on in the settings. Each
is switched on and off on its own and appears the same way: while you point at a word, or
while you hold a key over it (you choose which), and it goes when you move away or let go
of the key.

Tooltips that appear at the same moment, because they share a key or need none, are one
tooltip. Set all three to the same key to see everything about a word at once.

### 1 · Meanings

Point at an abbreviation to see its meaning. Under it, the tooltip can say how sure the
meaning is:

| Line in the tooltip                                           | Where the meaning comes from                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defined in this paper                                         | The paper defines it, and the abbreviation's letters match the words                                                                                |
| Probable meaning: the words before the bracketed abbreviation | The paper introduces the abbreviation in brackets, but the letters don't match the words before it ("a cytoprotective transcription factor (ATF4)") |
| From X other papers in your library                           | The paper doesn't define it; your other papers do                                                                                                   |
| Common term; not explicitly defined in this paper             | The paper doesn't define it; the built-in glossary does                                                                                             |
| Your own definition                                           | You defined it in Settings                                                                                                                          |

**Say where each meaning comes from** in the settings (on by default) turns this line on
or off.

### 2 · Database links

Once switched on in the settings, hold **Shift** (by default) over a gene, protein, cell
line or chemical name for links to look it up: on their own for a word without a meaning,
or under a meaning. The links are one numbered row, named after their database. If you
used 2.1.0 with database links on, they stay on after the update. Built in:
HGNC, UniProt, GeneCards, NCBI Gene, Cellosaurus, ATCC and PubChem are on; Ensembl,
InterPro, RCSB PDB, RNAcentral and Addgene are available and off until you tick them in
the settings.

### 3 · Where a word is used

Once switched on in the settings, hold **Ctrl** (or **Cmd** on macOS; by default) over
any word, and the tooltip lists the word's first uses in the paper: the page, and the
sentence around each one. It works on every word, and is most useful for an abbreviation
the plugin found no meaning for, since its first use usually defines it. Choose a use to
go there: the reader turns to the page and marks the word for a moment, in the green of a
search match (Ctrl/Cmd+F), and its Back button takes you back. In Reading Mode the jump
goes to the page.

To choose, press a number while still holding the key, or move the pointer onto the
list and click. The key can be Shift, Ctrl/Cmd or Alt (it cannot be "Always": a
list under every word you point at would bury the page), and the list can show 1, 3, 5
or 10 uses. If you updated from 2.1.0 with Ctrl/Cmd set for meanings or database links,
it takes Shift or Alt instead, so that tooltip looks as it did; choose Ctrl/Cmd yourself
to have the two together.

### Settings

Everything is in **Zotero Settings → Abbreviation Helper** (or **Tools → Abbreviation
Helper → Settings…**), in the same order: one section for each of the three tooltips,
each starting with its on/off switch and, on the same line, a **Show:** choice of what
brings it up, with its options indented under it; then the appearance they share and the
abbreviations file. Your own abbreviations and the ignore list are under Meanings,
editable in place with no JSON to hand-edit. Changes apply immediately.

Definitions you add there are authoritative: they are shown even when a paper defines
the short form differently. A definition or ignore entry covers the singular and the
plural ("EV" also covers "EVs").

**Use definitions from my other papers** (on by default) remembers the definitions in
the papers you open and offers them for papers that use an abbreviation without
defining it. Researchers tend to read many papers from one field, where an abbreviation
usually means the same thing. A meaning from your library is only used when the paper
mentions what it is about, and never where the paper defines the abbreviation itself.
Turning the setting off stops both remembering and using. **Forget learned definitions**,
under it, clears what was learned so far. A paper's supplement counts as the same paper.

### Tools menu

**Tools → Abbreviation Helper** holds the actions, and the settings in the same order as
the Settings window:

| Menu item | What it does |
|---|---|
| Settings… | Opens the pane above |
| Scan This PDF and Copy List | Copy the full list for the PDF in the reader (or, in the library, the selected item's PDF) to the clipboard |
| 1 · Meanings | Off, Always or a key; where each meaning comes from; definitions from your other papers |
| 2 · Database Links | Off, Always or a key; links under a meaning; which databases |
| 3 · Where a Word Is Used | Off or a key; how many uses are listed |
| Tooltip Appearance | Text size and theme |
| Ignore an Abbreviation… | Suppress a wrong detection |
| Ignored Abbreviations (n) | Click any entry to stop ignoring it |
| Open Abbreviations File… | Opens your settings file |
| Reload Abbreviations File | Apply edits without restarting Zotero |

A tooltip's options are greyed out while it is off. On Windows and Linux the menu stays
open while you change several settings; **on macOS it always closes after each one**,
because the menu bar there is a native `NSMenu` and macOS dismisses those on selection
— no plugin can override it. The Settings window is the easier place for several
changes.

**On macOS the Ctrl setting also accepts ⌘ Command**, and the menu labels it that way (and
Alt as ⌥ Option). One saved preference therefore behaves correctly on every platform,
which matters if your Zotero profile is moved between machines. On Windows and Linux only
Ctrl counts: the Windows or Super key opens the Start menu or the desktop's overview when
let go.

## The abbreviations file

Most people will never need this — abbreviations, the ignore list and the databases
are all editable in the settings pane. It is here for bulk edits, for backing up your
entries, and for adding lookup databases of your own.

Everything is stored in one JSON file inside your Zotero data directory:

```
<Zotero data directory>/abbreviation-helper/abbreviations.json
```

It is created empty on first run — the bundled dictionary is *not* copied into it, so your
entries stay easy to find and you still receive improvements to the shipped defaults.

```json
{
  "userDefs": { "MSA": "mannitol salt agar" },
  "ignore": ["NEB"],
  "databases": [
    { "group": "Gene/protein databases", "label": "UniProt",
      "url": "https://www.uniprot.org/uniprotkb?query={q}", "enabled": true }
  ]
}
```

- `userDefs`: your own definitions. These win over whatever the paper says.
- `ignore`: never show a meaning for these.
- `databases`: lookup links. `{q}` is the token without hyphens, `{raw}` the token as
  written. A non-empty list here **replaces** the built-in databases.

The file must be valid JSON, so it cannot contain comments. If it has a mistake, the
plugin says so in the settings pane, leaves the file untouched, and uses only the
built-in dictionary until you fix it.

Use **Reload from file** in the settings pane (or **Reload Abbreviations File** in the
Tools menu) after editing; no restart required.

## How detection works

Detection extends the [Schwartz–Hearst algorithm](https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf)
(Biocomputing 2003). A short form is paired with the words next to it, and the pair is
kept only if the short form's letters appear, in order, in those words. Where the
original takes the shortest stretch of text containing the letters, every possible
stretch is scored here: a letter at the start of a word scores most, and a word that
contributes no letter counts against it. So "mitochondrial inner membrane potential
(MMP)" keeps all four words. The same scorer judges every way papers define
abbreviations:

- long form (SF), long form [SF], (long form, SF) and SF (long form);
- "long form, hereafter SF", "abbreviated as SF", "termed SF";
- table and figure keys: "SF = long form" and "SF, long form; SF, long form";
- author-written "Abbreviations" lists (comma-, colon-, space- and line-delimited).

Before that, reference-list lines are dropped one by one, so Methods sections placed
after the references are still read. Running page headers and footers are removed too,
so a definition split across two pages is still found.

What the letters cannot confirm is filled in afterwards, less certain at each step and
marked as such in the tooltip:

1. **The words before the bracket.** When a paper introduces an abbreviation in brackets
   on its first use and uses it again, the noun phrase just before the bracket is offered
   as its probable meaning.
2. **Your other papers.** For an abbreviation a paper uses at least twice without
   defining it, the meaning your other papers define, if the paper mentions what that
   meaning is about.
3. **The curated glossary** of well-known abbreviations. Entries whose meaning depends
   on the field (EM, NTA, MHC, ER, TCA) appear only when words from their field occur in
   the paper; there, your other papers decide which of the glossary's meanings applies.

A definition the paper gives always wins. A meaning from your library or a field-dependent
glossary entry never appears where the paper defines the abbreviation itself, even in
words the detector cannot read, unless the paper also writes that meaning out.

Everything runs locally. No network requests are made except when you click a database
link.

### Dictionary provenance

The bundled dictionary in `data/abbreviations.json` was written by hand for this
project. It is not extracted from, derived from, or a copy of any external
abbreviation database, and carries no third-party licence obligations. It holds
common scientific abbreviations (DNA, PCR, ELISA and similar). Each is marked as
unambiguous across fields or as field-dependent, with the words that identify its
field. A small set of other terms is used only to normalise definitions a paper
already provides.

The detection method extends the published Schwartz–Hearst algorithm, cited
above; the implementation here is original.

### Accuracy

Measured with the benchmark in `eval/benchmark/`, which has its own labelling rules
(`GUIDELINES.md`). The dev set was used while developing the detector. The test set is
39 open-access papers drawn at random from 37 journals, and it was not used for tuning.

| | dev (36 papers) | test (39 papers) |
|---|---|---|
| Defined abbreviations found | 90.7 % | 88.6 % (84.5–92.4) |
| Meaning correct, when found | 95.8 % | 96.3 % (94.2–97.9) |
| Undefined ones found through the glossary | 91.6 % | 53.5 % (39.4–67.1) |
| Outputs that are right (precision) | 99.8 % | 94.1 % (90.4–96.9) |

The ranges are 95 % intervals from resampling papers. Version 2.1.0 scored 82.6 %, 95.0 %,
42.9 % and 98.7 % on the test set. The dev figures flatter this version: the glossary
additions were chosen from dev misses, and the dev labels were checked against this
detector's output. The test labels were checked against 2.1.0's output instead, which
flatters 2.1.0's precision there.

These figures leave out definitions from other papers, which need a library. Simulated
by giving each test paper the definitions found in the other 38, they raise the
undefined abbreviations found from 53.5 % to 60.0 %, with 95.1 % of those meanings
correct, at a cost of 0.3 points of precision.

Known limitations: long forms that do not contain the short form's letters in order
("dissociation constant (KD)", "NRF2 (NFE2L2)"), names in other languages ("Zentrum für
Molekulare Biologie (ZMBH)"), and abbreviations missing from the glossary. Definitions
that only describe ("a cytoprotective transcription factor (ATF4)") are offered as
probable meanings only. The ignore list deals with wrong ones case by case.

## Privacy

Zotero plugins run with full access to your computer, so it is fair to ask what
this one does:

- PDF text is extracted and analysed **entirely on your machine**. Nothing is
  uploaded, and no analytics or telemetry of any kind are collected.
- The plugin makes **no network requests at all** during normal use. The only
  network activity is Zotero's own periodic check of `update_url`, and a request
  to a database site when *you* click one of its links.
- It writes two files, both in `<Zotero data directory>/abbreviation-helper/`: your
  settings file, `abbreviations.json`, and `library-definitions.json`, the
  abbreviations and meanings defined in the papers you opened (with each paper's
  Zotero item key), used by **Use definitions from my other papers**. Nothing else
  from your papers is stored. Both are written through a temporary file, so a crash
  cannot leave them half-written.

## Development

```
node test/test-runaway.js    # long-form runaway guards
node test/test-peptides.js   # peptide-sequence filtering
node test/test-prefs.js      # preference persistence
node test/test-hover.js      # tooltip rendering (mock DOM)
node test/test-userdict.js   # user dictionary, end to end
node test/test-features.js   # menu features, modifiers, cross-platform paths
node test/test-menu.js       # Tools menu structure and wording (fake XUL DOM)
node test/test-settings.js   # Settings pane wiring, parsed from settings.xhtml
node test/test-fixes.js      # active tab, settings file safety, background scan, tooltips
node test/test-certainty.js  # probable meanings, definitions from other papers, tooltip origin line
node test/test-review.js     # singular/plural entries, hovered words, the library store
node test/test-lifecycle.js  # startup and shutdown through bootstrap.js
node test/test-upgrade.js    # updating from 2.1.0: settings and abbreviations file carry over
node test/test-uses.js       # where a word is used: finding uses, the held key, the list and the jump

node eval/benchmark/score.js dev <dir>   # accuracy on the benchmark (needs the texts)
node eval/benchmark/intervals.js dev <dir>   # 95 % intervals, and old-vs-new differences
node eval/score.js           # accuracy against the older gold standard (needs a corpus)
node eval/difftest.js A B    # prove a change leaves detection unchanged
```

### A note on the Tools menu

Zotero 8 added `Zotero.MenuManager.registerMenu()`, and plugins are encouraged to
use it instead of injecting menu items directly. This plugin still injects its
own menu, deliberately: `MenuData` currently supports only `menuType`, `l10nID`,
`icon` and event hooks — there are no checkable or radio items, and no plain
`label` (Fluent IDs only, with `l10nFiles` commented out in the Zotero source).
The settings menu here is almost entirely checkboxes and radio groups, so
migrating today would mean losing them. Worth revisiting when the API grows
checkable items.

### Reproducing the accuracy figures

The paper texts are copyrighted and are **not** included here. Export them from
Zotero as described in `eval/benchmark/README.md`, then run
`node eval/benchmark/score.js dev|test <folder with the texts>`.

The older gold standard, `eval/gold-standard.json` (22 papers, now part of the
dev set), is still run by `./build.sh --check` when its `corpus/` folder is
present: download the papers, run `pdftotext` on each into `corpus/` using the
filename in the `file` field, then run `node eval/score.js`.

## Building

```
./build.sh           # validate, package, print the SHA-256 for update.json
./build.sh --check   # the above, plus the full test suite and accuracy run
```

The same `--check` run happens on GitHub for every push and pull request
(`.github/workflows/test.yml`). It only tests; it never publishes anything.

## Packaging notes

Two things that are easy to get wrong when building the `.xpi`:

- **`update_url` is required.** Zotero refuses to install a plugin whose
  `applications.zotero` block has no `update_url`, with the unhelpful message
  *"could not be installed. It may be incompatible with this version of Zotero."*
  It is not optional, even for a plugin distributed manually.
- Zip the files **at the archive root** (`manifest.json` at top level, not inside
  a folder):

```
  zip -X -9 abbreviation-helper-<version>.xpi \
      manifest.json install.rdf bootstrap.js abbreviation.js prefs.js \
      settings.xhtml settings.js settings.css \
      icon32.png icon48.png icon96.png data/abbreviations.json
```

`update.json` in the repo root is what `update_url` points at; bump the version
and the release link there when you publish a new version. Everyone who has the
plugin installed reads this file from the `main` branch, so change it only when a
release is actually published.

Take `update_hash` from the exact `.xpi` you upload. The SHA-256 depends on the
`zip` program that built the archive, so rebuilding the same version on another
machine gives a different hash, and Zotero refuses an update whose hash does not
match.

## Licence

MIT — see `LICENSE`.
