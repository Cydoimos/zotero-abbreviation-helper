# Abbreviation Helper

A Zotero plugin that expands **acronyms, initialisms and other abbreviations** while you
read. It finds where a paper defines each short form and shows the meaning when you hover
over it — so you can skim a PDF without scrolling back to hunt for the first use.

"Abbreviation" is the umbrella term used throughout, and it is the accurate one: in the
22-paper evaluation set only 42 % of the short forms are true acronyms or initialisms.
The rest are mixed-case forms (`sgRNA`, `dCas9`), clippings (`Pfu`), blends (`cryo-EM`)
and symbols — all of which this plugin handles.

It also offers optional database lookup links (gene, protein, cell line, chemical) for
code-like tokens under the cursor.

Works on **macOS, Windows and Linux**. Requires **Zotero 7 or newer**
(tested on Zotero 9.0.6).

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

Open a PDF in the Zotero reader. The plugin scans it in the background; hover over any
abbreviation to see its meaning.

### Settings

Everything is in **Zotero Settings → Abbreviation Helper** (or **Tools → Abbreviation
Helper → Settings…**): hover behaviour, modifier keys, which databases are enabled,
tooltip appearance, and — editable in place, with no JSON to hand-edit — **your own
abbreviations** and the **ignore list**. Changes apply immediately.

Definitions you add there are authoritative: they are shown even when a paper defines
the short form differently.

### Tools menu

**Tools → Abbreviation Helper** holds the actions:

| Menu item | What it does |
|---|---|
| Settings… | Opens the pane above |
| Scan This PDF and Copy List | Rescan now and copy the full list to the clipboard |
| Ignore an Abbreviation… | Suppress a wrong detection |
| Ignored Abbreviations (n) | Click any entry to stop ignoring it |
| Open Abbreviations File… | Opens your settings file |
| Reload Abbreviations File | Apply edits without restarting Zotero |

Tick **Show every setting in the Tools menu** in the settings to mirror every
setting here as well. On Windows and Linux that menu stays open while you change
several settings; **on macOS it always closes after each one**, because the menu bar
there is a native `NSMenu` and macOS dismisses those on selection — no plugin can
override it. That is why settings live in the Settings window.

**On macOS the Ctrl setting also accepts ⌘ Command**, and the menu labels it that way. One
saved preference therefore behaves correctly on every platform, which matters if your
Zotero profile is synced between machines.

While a tooltip with database links is showing, press **1–9** to open the matching link.

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

```jsonc
{
  // Your own definitions. These win over whatever the paper says.
  "userDefs": { "MSA": "Mannitol Salt agar" },

  // Never show a meaning for these.
  "ignore": ["NEB"],

  // Lookup links. {q} = token without hyphens, {raw} = token as written.
  // A non-empty list here REPLACES the built-in databases.
  "databases": [
    { "group": "Gene/protein databases", "label": "UniProt",
      "url": "https://www.uniprot.org/uniprotkb?query={q}", "enabled": true }
  ]
}
```

Use **Reload from file** in the settings pane (or **Reload Abbreviations File** in the
Tools menu) after editing; no restart required.

## How detection works

Detection follows the [Schwartz–Hearst algorithm](https://psb.stanford.edu/psb-online/proceedings/psb03/schwartz.pdf)
(Biocomputing 2003): find a short form in parentheses, take the neighbouring text as the
candidate long form, and align the two right-to-left. On top of that:

- author-written "Abbreviations" lists are parsed directly (comma-, colon- and
  whitespace-delimited layouts are all handled, since publishers differ);
- a fuzzy alignment score acts as a fallback;
- a curated glossary supplies well-known abbreviations a paper uses but never defines,
  with ambiguous entries requiring contextual support;
- peptide sequences, supplier names and PDF extraction artefacts are filtered out.

Everything runs locally. No network requests are made except when you click a database
link.

### Privacy

Zotero plugins run with full access to your computer, so it is fair to ask what
this one does:

- PDF text is extracted and analysed **entirely on your machine**. Nothing is
  uploaded, and no analytics or telemetry of any kind are collected.
- The plugin makes **no network requests at all** during normal use. The only
  network activity is Zotero's own periodic check of `update_url`, and a request
  to a database site when *you* click one of its links.
- The only file it writes is your own settings file, at
  `<Zotero data directory>/abbreviation-helper/abbreviations.json`.

### Dictionary provenance

The bundled dictionary in `data/abbreviations.json` was written by hand for this
project. It is not extracted from, derived from, or a copy of any external
abbreviation database, and carries no third-party licence obligations. It holds
common scientific abbreviations (DNA, PCR, ELISA and similar) plus a small set
of terms used only to normalise definitions a paper already provides.

The detection method is the published Schwartz–Hearst algorithm, cited above;
the implementation here is original.

### Accuracy

Measured against a hand-labelled gold standard of **357 abbreviations across 22 papers**
from 12 publishers (MDPI, Nature, eLife, PLOS, Oxford/NAR, Frontiers, Wiley, JBC, BMC,
Cell Press, Rockefeller, bioRxiv):

| Metric | Result |
|---|---|
| Recall (abbreviations found) | 94.7 % |
| Meaning correct | 90.5 % |
| Meaning correct or partially correct | 97.9 % |
| Precision (sample-estimated) | ≈ 95 % |

Known limitations: supplier acronyms that happen to align (`NEB`), gene names paired with
nearby prose (`PTEN`), short peptide sequences, and short forms containing a space
(`Pol II`). The ignore list exists to deal with these case by case.

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

node eval/score.js           # accuracy against the gold standard (needs a corpus)
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

`eval/gold-standard.json` lists all 22 papers and their hand-labelled
abbreviations, but the extracted paper text is copyrighted and is **not**
included here. All 22 are open access; download them, run `pdftotext` on each
into `corpus/` using the filename in the `file` field, then run
`node eval/score.js`.

## Building

```
./build.sh           # validate, package, print the SHA-256 for update.json
./build.sh --check   # the above, plus the full test suite and accuracy run
```

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
and the release link there when you publish a new version.

## Licence

MIT — see `LICENSE`.
