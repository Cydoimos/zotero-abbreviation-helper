# Changelog

All notable changes to this project are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
