# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [2.2.0] — 2026-11-01

A rewritten abbreviation detector, tooltips that say how sure a meaning is,
meanings learned from your other papers, and bug fixes from a code audit.
Still supports Zotero 7.0 to 10.*, with the same settings and the same
abbreviations file.

### Detection
- **One scorer for every kind of definition.** Each short form is paired with
  the words next to it and kept only if its letters align with them, as
  before. But every possible span is now scored, instead of the shortest one
  being taken: letters at the start of words count most, and words that
  contribute nothing count against the span. "Translocase of the Outer Membrane
  (TOM)" is no longer cut to "Outer Membrane". The same scoring now judges
  bracketed definitions, "SF (long form)", "hereafter SF", table keys
  ("SF = …") and abbreviation lists. It replaces many special-case rules.
- **The reference list is dropped line by line** instead of cutting the paper
  off where the references start. Methods placed after the references (Cell
  Press STAR Methods, Science) are read again.
- **Running page headers and footers are removed** ("ACCEPTED MANUSCRIPT",
  bioRxiv licence lines), so definitions split across two pages are found and
  no longer pick up header text. The PDF text now reaches the detector with
  its page breaks intact.
- A short form whose first candidate definition fails is no longer blocked
  for the rest of the paper. The most reliable acceptable definition wins.
- Short forms with digits, Greek letters, lowercase letters or a space are
  handled by the same rules ("IC50", "dCas9", "Pol II", "I/R"). Panel ranges,
  catalogue numbers, units, version numbers and author initials are not taken
  for abbreviations.
- More ways of defining are read: "(TBST: 20 mM Tris, …)", "upstream open
  reading frames, or uORFs", figure-legend keys such as "Eco: Escherichia coli,
  Bsu: Bacillus subtilis", and abbreviation lists that continue on the next
  page. A dictionary meaning written out in full is preferred to a shorter
  alignment ("half maximal inhibitory concentration (IC50)").
- Uses inside compounds count towards the glossary's "used at least twice"
  rule ("ATP-dependent" uses ATP, "LC-MS/MS" uses LC-MS), except in compounds
  the paper defines itself ("6HBC-PBS", where PBS is not phosphate-buffered
  saline).

### Glossary
- 73 standard abbreviations added (PDB, WT, dsDNA, IgG, UV, HIV, TAE, FWHM,
  PI3K and others). Each is marked as unambiguous across fields, or as
  field-dependent with the words that identify its field (EM, ESI, LB, TCA,
  ER and others).
- A definition the paper gives always wins over the glossary. A field-dependent
  meaning is now also withheld where the paper defines the abbreviation itself
  in words the detector cannot read, unless the paper writes that meaning out.
- Eleven existing entries that depend on the field are no longer treated as
  unambiguous. MMP is matrix metalloproteinase only in papers about the
  matrix (in mitochondrial papers it is the membrane potential). MHC can also
  be myosin heavy chain, NTA nitrilotriacetic acid, NGS normal goat serum and
  SNP sodium nitroprusside, and CTL often means "control". The others are GDP,
  ALS, CTLs, MMPs and SNPs.

### How sure a meaning is
- **Each tooltip says where its meaning comes from**, in a muted line under the
  meaning: defined in this paper, a probable meaning, from your other papers,
  a common term, or your own definition. The same note is kept when meanings
  are copied.
- **Probable meanings.** When a paper introduces an abbreviation in brackets
  but its letters don't match the words before it ("a cytoprotective
  transcription factor (ATF4)"), those words are offered as its probable
  meaning, if the abbreviation is used again and not before the bracket.
- **Definitions from your other papers** (new setting **Use definitions from
  my other papers**, on by default). The definitions found in the papers you
  open are remembered in `library-definitions.json`, next to your
  abbreviations file, and offered for papers that use an abbreviation without
  defining it. A meaning is only used when the paper mentions what it is
  about, never where the paper defines the abbreviation itself, and for a
  field-dependent glossary entry it only picks among the glossary's meanings.
  Turning the setting off stops both learning and using. Settings show how
  many papers it has learned from, with a button to forget them. A paper's
  supplement counts as the same paper.

### Reading Mode
- Tooltips work in Zotero 10's Reading Mode for PDFs, which shows the paper as
  reflowed text in a page of its own. Reading Mode for web snapshots is left
  alone, since the meanings come from a PDF.
- Tooltips also work over highlighted text there. Reading Mode draws each
  highlight as a clickable box over the words, which hid them from the plugin.

### Added
- **Where a word is used** (off until switched on). Hold Ctrl (Cmd on
  macOS) over any word to list its first uses in the paper, with their
  pages and the words around them; click one, or let go of the key and
  press its number, to go there (the reader marks the word, and its Back
  button returns). Most useful for abbreviations without a meaning, whose
  first use usually defines them. It can be shown with Shift, Ctrl/Cmd or
  Alt, and list 1, 3, 5 or 10 uses. If you already hold Ctrl for meanings
  or database links, it takes Shift or Alt, so they look as before.
- **One look for the three tooltips** (meanings, database links, where a
  word is used): the word in bold and what the tooltip says, quieter lines
  under it, and numbered choices chosen the same way everywhere, by click
  or by number (1–9, then 0 for the tenth). Each shows while you point or
  hold its key, and goes when you move away or let go. Database links are
  one row of numbered choices, named after their database, instead of
  underlined links.
- **Tooltips that share a key show as one**, in parts set off by thin
  lines: the meaning, the database links, then the uses. Numbers run on
  from one part to the next. Set all three to one key to see everything
  about a word at once.
- **The settings follow the three tooltips**: an overview listing them, a
  numbered section for each, its switch and "Show:" choice on one line and
  its options indented under it, then the shared appearance. Your own
  abbreviations and the ignore list sit under Meanings.
- **The Tools menu has every setting, in the same order**: a submenu for
  each tooltip (Off, Always or a key, then its options, greyed out while it
  is off) and one for the appearance. The setting **Show every setting in
  the Tools menu** is gone.
- **Show where each meaning comes from** (on by default) in the settings
  hides the line under each meaning when turned off.
- Five more databases, off until ticked in the settings: Ensembl, InterPro,
  RCSB PDB, RNAcentral and Addgene.
- Lines between the sections of the settings, as in Zotero's own panes.

### Measured
- On the new benchmark (`eval/benchmark/`), on 39 test papers not used for
  tuning: defined abbreviations found rose from 82.6 % to 88.6 % (+5.9 points,
  95 % interval 2.7 to 9.0), with the meaning correct in 96.3 % (was 95.0 %).
  Undefined ones found through the glossary rose from 42.9 % to 53.5 %.
  Precision is 94.1 % (was 98.7 %), against labels that were checked only
  against the previous detector's output.
- Definitions from other papers need a library, so they are not in these
  figures. Simulated by giving each test paper the definitions of the other
  38, they raise the undefined abbreviations found from 53.5 % to 60.0 %, at
  0.3 points of precision.

### Changed defaults
- **Only meanings are on for a new install.** Database links and where a
  word is used are switched on in the settings. Database links were on by
  default before: if you update from 2.1.0 and never switched them off,
  they stay on.

### Fixed
- **Database links shown "Always", or with a key other than the one for
  meanings, now appear.** They only appeared while the meanings' key was
  held too, and not at all with meanings switched off. Each tooltip now
  counts on its own.
- On Windows and Linux, letting go of Alt after holding it for a tooltip no
  longer moves the keyboard to the menu bar, which took the number pressed
  next.
- A tooltip comes and goes with its key even when the keyboard focus is
  outside the paper (in the reader's toolbar, say); it waited for the mouse
  to move.
- **The 1–9 keys open database links on every keyboard layout.** They read
  the character typed, so on a German keyboard Shift+1 ("!") did nothing,
  and on a French one the keys only worked with Shift.
- Escape, and a click elsewhere, close a tooltip with links even when another
  page of the reader (the PDF or its Reading Mode) has the keyboard focus.
- Holding a modifier key no longer rebuilds the tooltip on every key repeat
  (Windows and Linux repeat them); it is redrawn only when the key changes.
- A tooltip still showing the previous paper's meaning is hidden when you
  switch tabs.
- A dash at the edge of a word is not part of the abbreviation: hovering the
  "EV-" of "EV- and exosome-derived" explains EV.
- **Ignoring an abbreviation hides its singular and plural too**: ignoring
  "EV" also hides "EVs". Likewise, your own definition of "EV" is now used in
  a paper that writes "EVs"; it was ignored there.
- **"Ignore an Abbreviation…" suggested the word as hovered**, punctuation
  included ("DNA."), which then matched nothing. It now suggests the
  abbreviation as detected, and the tooltip names it without the punctuation.
- The meaning shown for an affixed form ("DNA-positive") no longer has the
  "(common term; …)" note in the middle of it.
- Each abbreviation in a pair joined by a slash ("CD4/CD8", "PI3K/AKT") is
  explained on its own; hovering either showed nothing.
- Error messages in Settings are red, as intended: the colour was invalid CSS
  and was dropped.
- Database links follow the tooltip text size instead of a fixed 11 px.
- **Meanings now come from the paper you are reading.** The plugin looked for
  the active reader tab in a place Zotero does not provide to plugins, so it
  always used the item selected in the library instead. With several tabs open,
  tooltips could show another paper's definitions.
- **A hand-edited abbreviations file can no longer be wiped.** A file that was
  not valid JSON (for example one with comments) was silently ignored, and the
  next change made in Settings replaced it. Now the problem is shown in
  Settings and when reloading, and the file is never written until it is fixed.
- Two changes to your definitions or ignore list made in quick succession no
  longer lose the first one.
- Database links in a tooltip can be clicked. The tooltip used to let every
  click through to the page, and it now holds still while the pointer moves
  onto it. The 1–9 keys still work.
- On papers with no detected abbreviations, the hover listeners were rebuilt
  every 2.5 seconds, hiding any database-link tooltip.
- A tooltip no longer reappears at an old position, over different text,
  after scrolling or leaving the page and then pressing Shift or changing a
  setting.
- A variant spelling of one abbreviation (for example "Ab" made from "Aβ") no
  longer replaces a different abbreviation of the same paper.
- Disabling or updating the plugin while a PDF is being scanned no longer
  leaves the old version's listeners in the reader.
- "Open Abbreviations File…" falls back correctly when the file cannot be
  revealed.

### Changed
- The background scan only reads the PDF open in the active reader tab, and
  starts as soon as you switch tabs. Clicking through the library no longer
  scans each selected item's PDF.
- Changing a setting or your own definitions no longer reads the open PDF
  again; only the detection is redone.
- Moving the mouse within a word no longer rebuilds the tooltip.
- The abbreviations file is written through a temporary file.
- Removed two fallback text extractors that could not work in any supported
  Zotero version. `Zotero.PDFWorker.getFullText` is used, as before.
- Removed code that did nothing in Zotero: a second watcher for new windows
  (Zotero already calls the plugin for each one), a word lookup that only
  Chrome supports, and unused fields. Three old evaluation scripts replaced
  by `eval/benchmark/` are gone too.
- New regression tests (`test/test-fixes.js`, `test/test-review.js`), a test
  of startup and shutdown through `bootstrap.js` (`test/test-lifecycle.js`),
  a test of updating from 2.1.0 (`test/test-upgrade.js`), and a GitHub
  workflow that runs every test on each push.

## [2.1.0] — 2026-08-28

### Added
- Compatibility for Zotero 10.*.

## [2.0.0] — 2026-07-31

Settings move out of the Tools menu and into Zotero's Settings window, where
your own abbreviations and the ignore list can be edited directly instead of by
hand in a JSON file.

Versions 1.3–1.8 were development steps toward this and were never released;
their notes are folded in here.

### Added
- **Settings pane** in Zotero Settings → Abbreviation Helper, covering every
  option on one page. Changes apply immediately: the plugin watches its
  preference branch rather than reading it only at startup.
- **Your abbreviations, editable in place.** Add a short form and its meaning,
  see everything you have defined, remove entries. No JSON required. Your
  definitions still override whatever a paper says.
- **The ignore list, editable in place**, the same way.
- Both lists, and the databases, are **scrolling tables with sticky headers**,
  so a long list stays inside its box instead of pushing the pane off screen.
- **Show database links** — one switch for the whole lookup-link layer.
  Previously the only way to silence it was to uncheck all seven databases.
- **Show every setting in the Tools menu** — opt back in to the full menu on
  any platform.
- **Very small (10 px) and Very large (20 px)** tooltip sizes.
- `prefs.js` default preferences, so a setting never changed still has a value
  for the pane to show.
- Two new test suites: `test-menu.js` and `test-settings.js`.

### Changed
- **The Tools menu holds actions only by default**: Settings, Scan, Ignore an
  Abbreviation, and the two file actions. It is rebuilt each time it opens, so
  anything changed elsewhere is reflected without restarting Zotero.
- **One name for the settings file everywhere** — "abbreviations file". It had
  been variously "custom abbreviations file", "custom dictionary" and "config
  file", with two menu items calling the same function.
- Modifier choices read as sentences: "Always", "Only while holding Shift".
  Stored values are unchanged, so existing preferences carry over.
- Settings items carry `closemenu="none"`, so on Windows and Linux the menu
  stays open while several are changed.

### Fixed
- **Databases could not be switched off from the menu** — unchecking one
  silently re-enabled it. XUL flips a checkbox menuitem's `checked` attribute
  before firing its command event, so the handler read the new value and wrote
  back the old one. Present since databases first became configurable.
- **The Databases submenu was built once at startup**, so a database added to
  the file only appeared after restarting Zotero.
- **Menu checkboxes could show stale state** across windows.
- A database marked `"enabled": false` in the file **could never be switched on**
  from the menu.
- **Form controls now use Zotero's native styling.** Since Firefox 115 a XUL
  form element needs `native="true"` to be drawn as a platform control.

### Note on macOS
The Tools menu closes after every selection on macOS. Gecko renders the menu bar
there as a native `NSMenu`, and macOS dismisses native menus on selection as a
system behaviour — `closemenu` is only honoured on the XUL popup path. That is
why settings live in the Settings window, which has no such limit.

## [1.2.1] — 2026-07-31

### Changed
- Icon is now a wordmark reading "Abb." rather than an abstract glyph.
- Description now names acronyms and initialisms explicitly, so the plugin is
  findable by users searching either term. The name stays "Abbreviation Helper":
  abbreviation is the umbrella term, and 58 % of the short forms in the
  evaluation set are not acronyms in the strict sense.

## [1.2.0] — 2026-07-31

First public release.

### Added
- Plugin icon, shown in Zotero's Add-ons manager.
- `update_hash` (SHA-256) in `update.json`, so Zotero can verify a downloaded
  update.
- `build.sh`, a reproducible build script that refuses to package a manifest
  missing `update_url` — the mistake that caused several failed installs during
  development.
- Privacy statement and dictionary provenance in the README.

### Changed
- Declared compatibility is now `7.0`–`9.*`. The plugin previously claimed
  `6.0`–`*`, which was inaccurate in both directions: it uses Zotero 7 APIs
  (`createXULElement`, `getMainWindows`) and had never been tested above 9.
- Author is now `Cydoimos`.

### Notes
- **Zotero's MenuManager API was evaluated and not adopted.** It is the
  recommended way to add menu items in Zotero 8+, but as of this writing its
  `MenuData` supports only `menuType`, `l10nID`, `icon` and event hooks. It has
  no checkable or radio menu items and no plain `label` (only Fluent `l10nID`,
  and its `l10nFiles` option is commented out in the Zotero source). This
  plugin's menu is built from checkboxes, radio groups and a submenu rebuilt on
  open, none of which the API can currently express. Revisit when it supports
  checkable items.

## [1.1.4] — 2026-07-31

### Fixed
- **Installation failure.** Zotero requires `update_url` in
  `applications.zotero`; without it, installation fails with "may be
  incompatible with this version of Zotero", which misleadingly implicates the
  version fields. Restored.

## [1.1.0] — 2026-07-31

### Added
- Configurable modifier keys (None / Shift / Ctrl / Alt) for tooltips and for
  database links, set independently. On macOS the Ctrl setting also accepts ⌘.
- Databases moved into the config file: add, remove or reorder any lookup
  service, with a menu checkbox per database.
- Ignore list for false positives, editable from the menu in both directions.
- Tooltip text size and light/dark theme.
- MIT licence.

### Changed
- User dictionary entries (`userDefs`) are now authoritative — they override
  what the paper says. The config file is created empty rather than as a copy of
  the bundled dictionary, so personal entries stay visible and future dictionary
  improvements are not shadowed.
- Removed 80 dictionary entries specific to one research group. Accuracy did not
  drop; meaning accuracy improved slightly.

### Fixed
- Soft hyphens and typographic ligatures in PDF text no longer truncate terms
  (`FACS` was resolving to "activated cell sorting").
- Long capitalised words are no longer mistaken for abbreviations.
- Startup scan timer is cancellable; the scan cache is bounded.

## [1.0.x] — development

- Detection rewritten around Schwartz–Hearst alignment with author
  "Abbreviations" list parsing (comma-, colon- and whitespace-delimited).
- Peptide-sequence filtering, runaway long-form guards, mixed-case nomenclature
  support (`sgRNA`, `dCas9`, `CRISPRi`).
- Preferences persist across restarts.
- Evaluation harness: 22 papers, 357 hand-labelled abbreviations.
