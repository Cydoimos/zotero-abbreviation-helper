# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-07-31

### Added
- **Show database links** — a single checkbox that turns the whole database
  lookup layer off. Previously the only way to silence it was to uncheck all
  seven databases one at a time, which worked but was not discoverable. The
  dependent menu items grey out while it is off, so nothing visible silently
  does nothing.
- `test/test-menu.js` — the Tools menu had no test at all, which is how the
  stale-databases bug below survived. It builds the menu against a fake XUL
  document and checks structure, wording, and the popupshowing rebuilds.

### Fixed
- **The Databases submenu was built once at startup.** A database added to the
  abbreviations file did not appear after *Reload*, only after restarting
  Zotero. It is now rebuilt each time it opens.
- **Menu state could go stale.** Preferences are shared between windows, but the
  checkboxes were drawn once and never re-read. The menu now re-syncs on open.

### Changed
- **Tools menu reorganised**, ordered by how often things are used rather than
  by how the code is arranged: scanning, the two on/off switches and the ignore
  controls stay at the top level, while modifier keys, database selection and
  tooltip appearance moved into submenus. Seventeen top-level rows became ten,
  and the four bold pseudo-header rows are gone — separators carry the grouping.
- **One name for the settings file.** It was variously "custom abbreviations
  file", "custom dictionary" and "config file" — three names for one file, with
  two separate menu items calling the same function. Everything now says
  "abbreviations file".
- The two "Hold key to show…" submenus merged into one **When to Show…**, so the
  two settings are visible side by side instead of split across the menu.
- Modifier choices are phrased to complete their heading: "Always" rather than
  "No key (always show)", "Only while holding Shift" rather than "Shift". The
  stored values are unchanged, so existing preferences carry over.
- **Ignored Abbreviations** shows a count in its label.

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
