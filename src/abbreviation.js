/*
 * Abbreviation Helper — main implementation.
 *
 * Extracts abbreviation/definition pairs from the PDF open in the Zotero
 * reader, then shows the meaning of an abbreviation on hover so a paper can be
 * skimmed without hunting for where each term was defined.  A second, separate
 * layer offers database lookup links (gene/protein, cell line, chemical) for
 * code-like tokens under the cursor.
 *
 * Layout of this file:
 *
 *   1. AbbrevText          Pure text/shape helpers and constants. No dependency
 *                          on Zotero, the dictionaries, or the current
 *                          document, so they are built once at load time.
 *   2. AbbreviationHelper  Everything stateful, grouped into sections:
 *                            - preferences (persisted via Zotero.Prefs)
 *                            - dictionaries (bundled + user-editable)
 *                            - Zotero UI (Tools menu)
 *                            - scanning and PDF text extraction
 *                            - abbreviation detection
 *                            - hover tooltips
 *                            - database lookup links
 *
 * Detection follows the Schwartz-Hearst algorithm (Biocomputing 2003): find a
 * short form in parentheses, take the neighbouring text as the candidate long
 * form, and align the two right-to-left.  A fuzzy alignment score acts as a
 * fallback, and explicit author-written "Abbreviations" lists are parsed
 * directly since they are the most reliable evidence a paper offers.
 *
 * Precision is favoured over recall: a candidate that cannot be aligned with
 * its long form, or that has no supporting evidence in the document, is
 * dropped rather than guessed at.  Only the first definition of an
 * abbreviation is retained.
 */

/* ============================================================================
 * Text and shape utilities
 *
 * Pure helpers with no dependency on Zotero, on the loaded dictionaries or on
 * the document being scanned.  They live here rather than inside the detector
 * so they are created once when the plugin loads instead of on every scan, and
 * so the detector itself reads as a pipeline rather than a 700-line function.
 * ============================================================================ */

/**
 * Minimum fuzzy alignment score required to accept a pair from a loose
 * parenthetical pattern when strict Schwartz-Hearst alignment fails.
 */
var DEFAULT_ALIGNMENT_SCORE_FLOOR = 1.0;

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

var stopwords = [
    // Keep this list narrow. Broad words such as protein, cells,
    // medium, buffer, serum, assay and concentration occur in many
    // real long forms (e.g. green fluorescent protein, culture medium,
    // phosphate buffered saline, critical micelle concentration).
    'wild-type', 'wildtype', 'knockdown', 'knocked', 'knockin',
    'knock-in', 'knockout', 'mutant', 'vehicle', 'control',
    'catalogue', 'cat#', 'cat.', 'lane', 'figure', 'fig', 'table'
];
var leadingStop = ['transported', 'towards', 'toward', 'using',
    'with', 'by', 'from', 'to', 'and', 'or', 'including', 'below', 'namely',
    'of', 'the', 'a', 'an', 'for', 'in', 'on', 'as', 'at'];
var romanNumerals = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];

function isPluralShortForm(abbr) {
    return /^[A-Z0-9\-\/]{2,}s$/.test(abbr) || /^[A-Z][a-z]?[A-Z0-9\-\/]{1,}s$/.test(abbr);
}
function singularShortForm(abbr) {
    if (!abbr || !abbr.endsWith('s')) return '';
    const base = abbr.slice(0, -1);
    // Avoid stripping the final s from ordinary short forms where
    // the s is very likely part of the abbreviation rather than a
    // plural marker.  Lowercase final s is the common scientific
    // pattern for plural abbreviations: EVs, NPs, BAs, CEs, etc.
    if (/[a-z]$/.test(abbr) && /[A-Z]/.test(base)) return base;
    // All-uppercase plurals are less common but occur in extracted
    // text after case normalization.  Only strip when the base is
    // still a plausible abbreviation.
    if (/^[A-Z0-9\-\/]{2,}$/.test(abbr) && /^[A-Z0-9\-\/]{2,}$/.test(base)) return base;
    return '';
}
function pluralShortForms(abbr) {
    const out = [];
    if (!abbr || /s$/.test(abbr)) return out;
    // Most academic plural abbreviations are formed by adding a
    // lowercase s: EV -> EVs, NP -> NPs, BA -> BAs.  Also add an
    // uppercase S fallback for PDFs that normalize case.
    if (/^[A-Z0-9\-\/]{2,}$/.test(abbr) || /^[A-Z][a-z]?[A-Z0-9\-\/]{1,}$/.test(abbr)) {
        out.push(abbr + 's');
        out.push(abbr + 'S');
    }
    return out;
}

function isDigitLeadingChemicalShortForm(abbr) {
    // Chemical/lipid abbreviations often begin with a locant number,
    // e.g. 4-HNE for 4-hydroxynonenal, 8-OHdG, 15d-PGJ2.  These are
    // only accepted as local definitions, not as fallback glossary
    // entries.  Keep the shape narrow so years, references and
    // catalogue numbers do not become abbreviations.
    return /^\d{1,2}[A-Za-z]?[-‑–—][A-Za-z][A-Za-z0-9]{1,8}s?$/.test(abbr);
}

function isWeakButPlausibleShortForm(abbr) {
    if (!abbr || abbr.length < 2 || abbr.length > 16) return false;
    if (/\s/.test(abbr)) return false;
    if (romanNumerals.includes(abbr)) return false;
    if (/^[0-9]+$/.test(abbr)) return false;
    if (!/^[A-Za-z0-9\u0391-\u03c9]/.test(abbr)) return false;
    const letters = (abbr.match(/[A-Za-z\u0391-\u03c9]/g) || []).length;
    if (letters < 2) return false;
    // Needs some non-lowercase signal: an uppercase letter, a digit or
    // a Greek character. Purely lowercase words are ordinary prose.
    if (!/[A-Z0-9\u0391-\u03c9]/.test(abbr)) return false;
    // A long word with a single leading capital is almost always an
    // ordinary proper noun ("Canada", "Barcelona") rather than an
    // abbreviation. Genuine mixed-case short forms either stay short
    // (Tfh, Inr, Pfu, Arc) or carry a second capital, a digit or a
    // Greek letter (sgRNA, dCas9, DepMap, Egr1, AtAGO1, PLC\u03b2).
    const caps = (abbr.match(/[A-Z]/g) || []).length;
    if (caps < 2 && !/[0-9\u0391-\u03c9]/.test(abbr) && abbr.length > 4) return false;
    return true;
}

function cleanTerm(term) {
    let cleaned = term.replace(/\s+/g, ' ').trim();
    // Reagent definitions often carry the working concentration, e.g.
    // "0.5 mM sodium taurodeoxycholate hydrate".  The quantity is not
    // part of the term.
    cleaned = cleaned.replace(/^\d+(?:[.,]\d+)?\s*(?:mM|\u00b5M|\u03bcM|uM|nM|pM|M|mg|\u00b5g|\u03bcg|ng|g|kg|mL|ml|\u00b5L|\u03bcL|L|%|U|kDa|Da|nm|mm|cm)\s+/i, '');
    cleaned = cleaned.replace(/^[,;:\-–—]+\s*/, '').replace(/\s*[,;:\-–—]+$/, '');
    let tokens = cleaned.split(/\s+/);
    while (tokens.length > 1 && leadingStop.includes(tokens[0].toLowerCase())) {
        tokens.shift();
    }
    cleaned = tokens.join(' ');
    return cleaned.replace(/\s+/g, ' ').trim();
}
function firstContentWord(s) {
    const words = String(s || '')
        .replace(/[()\[\],.;:]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter(w => !leadingStop.includes(w.toLowerCase()));
    return words.length ? words[0].toLowerCase() : '';
}

function findBestLongForm(shortForm, longForm) {
    // Schwartz–Hearst strict right-to-left alignment.
    let sIndex = shortForm.length - 1;
    let lIndex = longForm.length - 1;
    for (; sIndex >= 0; sIndex--) {
        const curr = shortForm[sIndex].toLowerCase();
        if (!/[a-z0-9]/.test(curr)) continue;
        while (lIndex >= 0 && (
            longForm[lIndex].toLowerCase() !== curr ||
            (sIndex === 0 && lIndex > 0 && /[a-z0-9]/i.test(longForm[lIndex - 1]))
        )) {
            lIndex--;
        }
        if (lIndex < 0) return null;
        lIndex--;
    }
    lIndex = longForm.lastIndexOf(' ', lIndex) + 1;
    const sub = longForm.slice(lIndex).trim();
    if (!sub || sub.length < shortForm.length) return null;
    return sub;
}
function hmmStyleScore(shortForm, longForm) {
    // Lightweight local dynamic alignment: initial-letter matches are
    // scored higher than internal matches, with small gap penalties.
    // This approximates the useful part of alignment-HMM behaviour
    // without training data or a large model.
    const sf = shortForm.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    const lf = longForm.toLowerCase();
    let pos = -1, score = 0, matched = 0;
    for (let i = 0; i < sf.length; i++) {
        const ch = sf[i];
        let best = -1, bestScore = -999;
        for (let j = pos + 1; j < lf.length; j++) {
            if (lf[j] !== ch) continue;
            const initial = (j === 0 || /[^a-z0-9]/.test(lf[j - 1]));
            const candidateScore = (initial ? 3 : 1) - Math.min(2, (j - pos - 1) * 0.05);
            if (candidateScore > bestScore) { bestScore = candidateScore; best = j; }
        }
        if (best < 0) return -999;
        score += bestScore;
        pos = best;
        matched++;
    }
    return matched ? score / sf.length : -999;
}

function splitAbbreviationEntries(block) {
    // Journals use at least three layouts for an abbreviation list:
    //   "BA, bile acids; CHD, coronary heart disease"      (comma)
    //   "TE: Trolox equivalent; SNP: sodium nitroprusside"  (colon)
    //   "AAV adeno-associated virus, Ab Antibody"           (whitespace)
    // Rather than guess, every layout is parsed and the one that yields
    // the most plausible entries wins.
    const text = String(block || '').trim();
    if (!text) return [];

    const looksLikeShortForm = (tok) => {
        if (!tok) return false;
        const t = tok.trim();
        if (t.length < 2 || t.length > 24) return false;
        if (/\s/.test(t)) return false;
        if (!/^[A-Za-z0-9\u0391-\u03c9]/.test(t)) return false;
        if (!/[A-Z0-9\u0391-\u03c9]/.test(t)) return false;
        return true;
    };
    const clean = (v) => String(v || '').replace(/\s+/g, ' ').replace(/^[\s,;:.]+|[\s,;:.]+$/g, '').trim();

    // Layout A/B: split on the separator, then on the first comma or
    // colon inside each entry (whichever appears first).
    const delimitedParse = (sep) => {
        const out = [];
        for (let chunk of text.split(sep)) {
            chunk = chunk.replace(/^\s*Abbreviations?\s*:?\s*/i, '').trim();
            if (!chunk) continue;
            const ci = chunk.indexOf(':'), mi = chunk.indexOf(',');
            const colonStyle = ci !== -1 && (mi === -1 || ci < mi);
            if (colonStyle) {
                const SF = '[A-Z0-9\u0391-\u03c9][A-Za-z0-9\u0391-\u03c9\\-\u2010-\u2015\\/\\.]{0,23}';
                const re = new RegExp('(?:^|\\s)(' + SF + ')\\s*:\\s*', 'g');
                const marks = []; let m;
                while ((m = re.exec(chunk))) marks.push({ abbr: m[1], start: m.index, end: re.lastIndex });
                for (let i = 0; i < marks.length; i++) {
                    const stop = (i + 1 < marks.length) ? marks[i + 1].start : chunk.length;
                    const term = clean(chunk.slice(marks[i].end, stop));
                    if (looksLikeShortForm(marks[i].abbr) && term) out.push({ abbr: marks[i].abbr.trim(), term });
                }
            } else if (mi !== -1) {
                const parts = chunk.split(',');
                const abbr = parts.shift().trim();
                const term = clean(parts.join(','));
                if (looksLikeShortForm(abbr) && term) out.push({ abbr, term });
            }
        }
        return out;
    };

    // Layout C: "SHORTFORM definition" pairs separated by commas or
    // semicolons, with no punctuation between the short form and its
    // expansion. The short form is the first whitespace-delimited token.
    const whitespaceParse = (sep) => {
        const out = [];
        for (let chunk of text.split(sep)) {
            chunk = chunk.replace(/^\s*Abbreviations?\s*:?\s*/i, '').replace(/\s+/g, ' ').trim();
            if (!chunk) continue;
            const sp = chunk.indexOf(' ');
            if (sp < 1) continue;
            const abbr = chunk.slice(0, sp).trim();
            const term = clean(chunk.slice(sp + 1));
            // Require a real short form and a definition of real words.
            if (!looksLikeShortForm(abbr) || !term || term.length < 3) continue;
            if (!/[A-Za-z]{3}/.test(term)) continue;
            out.push({ abbr, term });
        }
        return out;
    };

    const candidates = [
        delimitedParse(/;+/),
        delimitedParse(/,\s*(?=[A-Z0-9])/),
        whitespaceParse(/,\s*(?=[A-Za-z0-9])/),
        whitespaceParse(/;+/)
    ];
    let best = [];
    for (const c of candidates) if (c.length > best.length) best = c;
    return best;
}
function trimSectionLongForm(abbr, term) {
    // Bound a long form taken from an explicit "Abbreviations:" list.
    // Unlike the parenthetical patterns, the definition FOLLOWS the
    // short form here, so the window is taken from the start.
    let t = String(term || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // A list entry is a noun phrase, never a sentence: stop at the
    // first sentence boundary or trailing citation marker.
    const sentenceCut = t.search(/\.\s+[A-Z“"(\[]/);
    if (sentenceCut > 0) t = t.slice(0, sentenceCut);
    t = t.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]\s*$/, '').trim();
    // Schwartz-Hearst word window, with a small floor so ordinary
    // two-letter abbreviations keep their full definition.
    const sfLen = (String(abbr).match(/[A-Za-z0-9]/g) || []).length;
    const maxWords = Math.max(6, Math.min(sfLen + 5, sfLen * 2));
    const words = t.split(/\s+/);
    if (words.length > maxWords) t = words.slice(0, maxWords).join(' ');
    // Never let an explicit-list definition exceed a sane length.
    if (t.length > 120) t = t.slice(0, 120);
    return t.replace(/[\s,;:]+$/, '').replace(/\s+(?:and|or|of|the|a|an|to|in|for|with|all)$/i, '').trim();
}
function refineLongForm(abbr, term) {
    const cleaned = cleanTerm(term);
    // For digit-leading chemical abbreviations such as 4-HNE, the
    // strict alignment may trim the numeric locant from the long form
    // and return only “hydroxynonenal”.  Prefer the complete local
    // chemical token, e.g. “4-hydroxynonenal”, when present.
    if (isDigitLeadingChemicalShortForm(abbr)) {
        const locantTerms = cleaned.match(/\b\d{1,2}[A-Za-z]?[-‑–—][A-Za-z][A-Za-z0-9εβγδαΩω'’]*\b/g);
        if (locantTerms && locantTerms.length) {
            return { term: locantTerms[locantTerms.length - 1], strictAligned: hmmStyleScore(abbr, locantTerms[locantTerms.length - 1]) >= 0.75 };
        }
    }
    const strict = findBestLongForm(abbr, term);
    if (strict) return { term: strict, strictAligned: true };
    // Canonical Schwartz-Hearst guardrail: a long form spans at most
    // min(|SF|+5, |SF|*2) words. When strict alignment fails, trim the
    // candidate window to that length before the fuzzy score so an
    // over-long span of surrounding prose is not attached to the term.
    const sfLen = (String(abbr).match(/[A-Za-z0-9]/g) || []).length;
    const maxWords = Math.max(1, Math.min(sfLen + 5, sfLen * 2));
    const windowWords = cleaned.split(/\s+/);
    const windowed = windowWords.length > maxWords
        ? cleanTerm(windowWords.slice(-maxWords).join(' '))
        : cleaned;
    if (hmmStyleScore(abbr, windowed) >= 0.75) return { term: windowed, strictAligned: false };
    return { term: windowed, strictAligned: false };
}

// Create a global namespace.  Zotero assigns global variables per
// add-on into a shared scope.  We deliberately avoid polluting the
// global namespace beyond this object.
var AbbreviationHelper = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],
    cache: new Map(),
    // Scanned results per attachment. Bounded so a long session with many
    // PDFs cannot grow memory without limit; oldest entries are evicted.
    CACHE_LIMIT: 50,
    // Abbreviation dictionaries, loaded from the bundled data/abbreviations.json
    // plus an optional user-editable copy in the Zotero data directory.
    dictionaries: null,
    _dictionariesReady: null,
    // Hover is enabled by default. The plugin auto-scans the active reader
    // silently so users can hover abbreviations without first using a menu.
    hoverEnabled: true,
    // Optional safety mode: when enabled, even abbreviation tooltips require
    // Shift.  It is off by default.  Database lookup links are handled
    // separately and are shown only while Shift is held, so normal
    // abbreviation reading stays quiet and fast.
    // Modifier gating. 'none' means no key needs to be held. Abbreviation
    // meanings appear freely by default; database links ask for Shift so
    // ordinary reading stays uncluttered.
    tooltipModifier: 'none',
    databaseLinksModifier: 'shift',
    modifierState: { shift: false, ctrl: false, alt: false, meta: false },
    // Tooltip appearance.
    tooltipFontSize: 12,
    tooltipTheme: 'dark',
    // Database lookup links have their own modifier behavior.  By default
    // abbreviation meanings appear normally, while database sections only
    // appear while Shift is held.  This keeps ordinary reading uncluttered
    // but still lets users get database shortcuts for the token under the
    // cursor.
    databaseLinksOnAbbreviations: true,
    // Master switch for the whole database-link layer. When false, no lookup
    // links are offered at all and the plugin does nothing but expand
    // abbreviations. Unchecking every database individually has the same
    // effect, but this is the switch people look for.
    databaseLinksEnabled: true,
    // Whether the Tools menu mirrors every setting. Off by default: settings
    // live in the Settings window, and the menu holds actions. Users who
    // prefer the menu can turn this on — on Windows and Linux the menu even
    // stays open between changes.
    advancedMenu: false,
    lastHoverState: null,
    hoverDocs: [],
    autoScanTimer: null,
    autoScanFirstRun: null,
    autoScanInProgress: false,
    activeHoverMap: new Map(),
    activeHoverItemID: null,
    hoverHideTimer: null,
    hoverPinnedDoc: null,
    // Interactive tooltips contain clickable gene/protein database links.
    // They are allowed to remain visible while the cursor travels from
    // the PDF text to the tooltip. Plain abbreviation-only tooltips keep
    // the normal transient hover behavior.
    hoverInteractiveTooltip: false,
    activeGeneLinks: [],
    // Extracted text per attachment, so a change to your definitions or the
    // ignore list can be re-detected without reading the PDF again. Texts are
    // large, so only a few are kept.
    textCache: new Map(),
    TEXT_CACHE_LIMIT: 5,
    // Set when the plugin shuts down. Work that was already under way (a scan
    // waiting for Zotero's PDF worker, say) checks it before touching the
    // reader, so a disabled or updated plugin leaves nothing behind.
    _stopped: false,
    // The last abbreviation whose meaning was shown; "Ignore an
    // Abbreviation…" offers it as the default.
    lastHoveredToken: '',
    // Why the abbreviations file could not be read, or null when it is fine.
    // While it is set, nothing writes to the file.
    userFileError: null,
    // How long the pointer may spend heading for a tooltip with links before
    // the tooltip goes back to following the word under the pointer.
    CORRIDOR_MS: 350,

    /**
     * Initialise the plugin.  Stores metadata and ensures we only
     * initialise once.
     */
    init({ id, version, rootURI }) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        // Marks the tooltip elements this copy of the plugin creates, so a
        // tooltip left in a reader page by an earlier version is replaced
        // rather than reused (see _ensureHoverTooltip).
        this._instanceToken = 'ah-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        // Restore saved user preferences (hover mode, Shift behavior, enabled
        // database groups) so they persist across Zotero restarts.
        this._loadPrefs();
        // Seed with a small built-in fallback so the plugin still works if the
        // bundled JSON cannot be read, then load the full and user dictionaries
        // asynchronously. Scans await _dictionariesReady before detecting.
        this.dictionaries = this._embeddedFallbackDictionaries();
        this._dictionariesReady = this._loadDictionaries().catch(e => {
            this.log('Dictionary load failed; using built-in fallback: ' + e);
            return this.dictionaries;
        });
        // The preference pane runs in the Settings window, a separate document
        // with no reference to this scope. Zotero is the one object both can
        // see, so the pane reaches the plugin through it.
        try { Zotero.AbbreviationHelper = this; } catch (e) {}
        this._watchPrefs();
        this.initialized = true;
    },

    /* ---- Preference pane (Zotero 7+) ------------------------------------ */
    /**
     * Register the pane in Zotero's Settings window. Optional: if the API is
     * missing or registration fails, the plugin carries on and the Tools menu
     * remains the way to change settings.
     */
    registerPreferencePane() {
        try {
            if (!Zotero.PreferencePanes || !Zotero.PreferencePanes.register) {
                this.log('PreferencePanes API unavailable; using the Tools menu only');
                return null;
            }
            // Note the filenames: `prefs.js` in the plugin root is reserved by
            // Zotero for default preferences and is parsed as pref() calls, so
            // the pane's own script must not be called that.
            this._prefPaneID = Zotero.PreferencePanes.register({
                pluginID: this.id,
                src: 'settings.xhtml',
                scripts: ['settings.js'],
                stylesheets: ['settings.css'],
                label: 'Abbreviation Helper'
            });
            return this._prefPaneID;
        } catch (e) {
            this.log('Could not register the preference pane: ' + e);
            return null;
        }
    },

    unregisterPreferencePane() {
        try {
            if (this._prefPaneID && Zotero.PreferencePanes && Zotero.PreferencePanes.unregister) {
                Zotero.PreferencePanes.unregister(this._prefPaneID);
            }
        } catch (e) {
            this.log('Could not unregister the preference pane: ' + e);
        }
        this._prefPaneID = null;
    },

    /**
     * Watch the preference branch so changes made in the Settings window take
     * effect immediately. Without this the pane would write a preference that
     * the running plugin only notices at the next restart.
     */
    _watchPrefs() {
        if (this._prefObserver) return;
        try {
            if (typeof Services === 'undefined' || !Services.prefs) return;
            const branch = Services.prefs.getBranch(this.PREF_BRANCH);
            const self = this;
            this._prefObserver = {
                observe(subject, topic, data) {
                    if (topic !== 'nsPref:changed' || self._stopped) return;
                    try {
                        self._loadPrefs();
                        self._resetHoverTooltips();
                        if (!self.hoverEnabled) {
                            self._removeHoverListeners();
                            return;
                        }
                        self._refreshHoverFromLastState(null);
                        // Hover may just have been switched on in Settings.
                        self._autoScanActiveReader().catch(e => self.log('Auto-scan failed: ' + e));
                    } catch (e) {
                        self.log('Applying a changed preference failed: ' + e);
                    }
                }
            };
            branch.addObserver('', this._prefObserver, false);
            this._prefBranch = branch;
        } catch (e) {
            this.log('Could not observe preferences: ' + e);
        }
    },

    _unwatchPrefs() {
        try {
            if (this._prefBranch && this._prefObserver) {
                this._prefBranch.removeObserver('', this._prefObserver);
            }
        } catch (e) {}
        this._prefBranch = null;
        this._prefObserver = null;
    },

    // ---- Persistent preferences ------------------------------------------
    // Settings are stored under the extensions.abbreviation-helper.* branch via
    // Zotero.Prefs so they survive restarts. Each is read on startup and written
    // whenever the matching menu checkbox is toggled.
    /* ---- Preferences (persisted via Zotero.Prefs) ---- */
    PREF_BRANCH: 'extensions.abbreviation-helper.',

    _getPref(name, fallback) {
        try {
            const val = Zotero.Prefs.get(this.PREF_BRANCH + name, true);
            return (val === undefined || val === null) ? fallback : val;
        } catch (e) {
            return fallback;
        }
    },

    _setPref(name, value) {
        try {
            Zotero.Prefs.set(this.PREF_BRANCH + name, value, true);
        } catch (e) {
            this.log('Could not save preference ' + name + ': ' + e);
        }
    },

    _loadPrefs() {
        this.hoverEnabled = this._getPref('hoverEnabled', this.hoverEnabled);
        this.tooltipModifier = this._getPref('tooltipModifier', this.tooltipModifier);
        this.databaseLinksModifier = this._getPref('databaseLinksModifier', this.databaseLinksModifier);
        this.databaseLinksOnAbbreviations = this._getPref('databaseLinksOnAbbreviations', this.databaseLinksOnAbbreviations);
        this.databaseLinksEnabled = this._getPref('databaseLinksEnabled', this.databaseLinksEnabled);
        this.advancedMenu = this._getPref('advancedMenu', this.advancedMenu);
        // A menulist in the preference pane stores its value as a string,
        // while the menu's radio items store a number. Coerce so both routes
        // to the same setting produce the same type.
        this.tooltipFontSize = Number(this._getPref('tooltipFontSize', this.tooltipFontSize)) || 12;
        this.tooltipTheme = this._getPref('tooltipTheme', this.tooltipTheme);
    },

    /**
     * Minimal general-purpose fallback used only if both the bundled JSON and
     * the user dictionary fail to load. Locally defined abbreviations are still
     * detected without any dictionary; this only preserves a few very common
     * glossary lookups so hover never comes up completely empty.
     */
    /* ---- Dictionaries: bundled defaults + user-editable overrides ---- */
    _embeddedFallbackDictionaries() {
        return {
            userDefs: {},
            ignore: [],
            databases: [],
            staticDefs: {},
            commonKnownDefs: {
                'DNA': [{ term: 'deoxyribonucleic acid', ambiguity: 'low' }],
                'RNA': [{ term: 'ribonucleic acid', ambiguity: 'low' }],
                'PCR': [{ term: 'polymerase chain reaction', ambiguity: 'low' }],
                'ELISA': [{ term: 'enzyme-linked immunosorbent assay', ambiguity: 'low' }],
                'PBS': [{ term: 'phosphate buffered saline', ambiguity: 'low' }],
                'DMSO': [{ term: 'dimethyl sulfoxide', ambiguity: 'low' }],
                'BSA': [{ term: 'bovine serum albumin', ambiguity: 'low' }],
                'FBS': [{ term: 'fetal bovine serum', ambiguity: 'low' }]
            }
        };
    },

    /** Coerce arbitrary parsed JSON into the { staticDefs, commonKnownDefs } shape. */
    _normaliseDictionaries(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        return {
            staticDefs: obj(raw.staticDefs),
            commonKnownDefs: obj(raw.commonKnownDefs),
            // Your own definitions. Unlike staticDefs these are authoritative:
            // they are shown even when the paper defines the term differently.
            userDefs: obj(raw.userDefs),
            // Abbreviations to never display, for suppressing false positives.
            ignore: Array.isArray(raw.ignore) ? raw.ignore.filter(Boolean).map(String) : [],
            // Database lookup links.
            databases: Array.isArray(raw.databases) ? raw.databases.filter(d => d && d.label && d.url) : []
        };
    },

    /** Shallow-merge two dictionaries; entries in `extra` win. */
    _mergeDictionaries(base, extra) {
        base = base || {}; extra = extra || {};
        // A user-supplied database list replaces the defaults outright, so
        // entries can be removed and not just added to.
        const databases = (extra.databases && extra.databases.length)
            ? extra.databases : (base.databases || []);
        return {
            staticDefs: Object.assign({}, base.staticDefs, extra.staticDefs),
            commonKnownDefs: Object.assign({}, base.commonKnownDefs, extra.commonKnownDefs),
            userDefs: Object.assign({}, base.userDefs, extra.userDefs),
            ignore: [].concat(base.ignore || [], extra.ignore || []),
            databases
        };
    },

    /**
     * Load the bundled dictionary, then merge an optional user-editable copy
     * from the Zotero data directory over it. Never throws: any failure falls
     * back to whatever has loaded so far.
     */
    async _loadDictionaries() {
        let dicts = this._embeddedFallbackDictionaries();

        // 1) Bundled defaults shipped inside the plugin.
        try {
            const resp = await fetch(this.rootURI + 'data/abbreviations.json');
            if (resp && resp.ok) {
                const bundled = this._normaliseDictionaries(await resp.json());
                if (bundled) dicts = bundled;
            }
        } catch (e) {
            this.log('Could not read bundled dictionary: ' + e);
        }

        // 2) Optional user-editable override in the Zotero data directory. It is
        //    created on first run; its entries extend/override the defaults.
        try {
            const userDicts = await this._loadOrCreateUserDictionary(dicts);
            if (userDicts) dicts = this._mergeDictionaries(dicts, userDicts);
        } catch (e) {
            this.log('Could not read user dictionary: ' + e);
        }

        this.dictionaries = dicts;
        // Drop any results cached before the full dictionary was ready.
        try { this.cache.clear(); } catch (e) {}
        this.log('Dictionaries ready: ' + Object.keys(dicts.staticDefs).length +
            ' static, ' + Object.keys(dicts.commonKnownDefs).length + ' glossary entries.');
        return dicts;
    },

    /** IOUtils, preferring the runtime global and falling back to the module. */
    async _getIOUtils() {
        if (typeof IOUtils !== 'undefined') return IOUtils;
        const mod = await ChromeUtils.importESModule('resource://gre/modules/IOUtils.sys.mjs');
        return mod.IOUtils;
    },

    /** Join path segments using the separator implied by the base path. */
    _joinPath(base, ...parts) {
        const sep = base && base.indexOf('\\') !== -1 ? '\\' : '/';
        let out = String(base).replace(/[\\\/]+$/, '');
        for (const p of parts) out += sep + p;
        return out;
    },

    /**
     * Read the user dictionary at <dataDir>/abbreviation-helper/abbreviations.json,
     * creating an empty starter file on first run. Returns parsed dictionaries
     * or null. Throws (after recording userFileError) if the file exists but
     * cannot be read, so the caller falls back to the bundled defaults.
     */
    async _loadOrCreateUserDictionary(defaults) {
        const file = this._userDictionaryPath();
        if (!file) return null;
        const io = await this._getIOUtils();

        if (await io.exists(file)) {
            return this._normaliseDictionaries(this._parseUserConfig(await io.readUTF8(file)));
        }

        // First run: create the empty, editable starter file.
        this.userFileError = null;
        await this._ensureUserDictionaryFile();
        return null;
    },

    /**
     * Parse the text of the abbreviations file. If it is not a JSON object,
     * the reason is kept in userFileError (shown in Settings) and this throws,
     * so nothing ever writes over a file it could not read. An empty file
     * holds nothing to lose and counts as an empty object.
     */
    _parseUserConfig(text) {
        if (!String(text || '').trim()) {
            this.userFileError = null;
            return {};
        }
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (e) {
            const why = String((e && e.message) || e);
            this.userFileError = 'It is not valid JSON (' + why + '). Comments are not allowed in JSON.';
            throw new Error('Abbreviations file is not valid JSON: ' + why);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            this.userFileError = 'It must contain a JSON object, starting with { and ending with }.';
            throw new Error('Abbreviations file does not contain a JSON object');
        }
        this.userFileError = null;
        return raw;
    },

    /** One sentence saying why a change was not saved, for alerts and the Settings pane. */
    _saveFailedMessage() {
        if (this.userFileError) {
            return 'Nothing was saved, because your abbreviations file could not be read. '
                + this.userFileError + ' Open the file, correct it, then reload it.';
        }
        return 'Could not save the change. See the Zotero log for details.';
    },

    /**
     * The file created on first run. Deliberately EMPTY rather than a copy of
     * the bundled dictionary: a copy would bury the user's own entries and
     * would permanently shadow later improvements to the shipped defaults.
     */
    _starterUserConfig() {
        return {
            _comment: [
                'Your Abbreviation Helper settings. Most of this can be edited in',
                'Zotero Settings -> Abbreviation Helper. If you edit here instead,',
                'save the file and then use Reload from file in that pane.',
                'userDefs:   "ABC": "your meaning"  - always shown, wins over the paper.',
                'ignore:     ["NEB"]                - never show these.',
                'databases:  [{"group":"Gene/protein databases","label":"UniProt",',
                '             "url":"https://www.uniprot.org/uniprotkb?query={q}","enabled":true}]',
                '            {q} = token without hyphens, {raw} = token as written.',
                '            A non-empty list here REPLACES the built-in databases.'
            ].join(' '),
            userDefs: {},
            ignore: [],
            databases: []
        };
    },

    /**
     * Merge a patch into the abbreviations file on disk. Arrays are merged
     * without duplicates, objects are merged, and keys named in replaceKeys
     * are replaced outright. The caller reloads afterwards.
     */
    async _updateUserConfig(patch, replaceKeys) {
        const replace = new Set(replaceKeys || []);
        return this._editUserConfig((current) => {
            for (const [k, v] of Object.entries(patch || {})) {
                if (replace.has(k)) {
                    current[k] = v;
                } else if (Array.isArray(v)) {
                    const merged = [].concat(current[k] || [], v);
                    current[k] = merged.filter((x, i) => merged.indexOf(x) === i);
                } else if (v && typeof v === 'object') {
                    current[k] = Object.assign({}, current[k], v);
                } else {
                    current[k] = v;
                }
            }
        });
    },

    /**
     * Change the abbreviations file. `mutate` receives what is on disk now
     * (with any missing section filled in) and edits it in place; returning
     * false means there is nothing to change, and the file is not written.
     *
     * Every edit starts from the file rather than from memory, and edits run
     * one at a time, so two changes made in quick succession both survive. A
     * file that cannot be parsed is never written: the promise rejects and the
     * file stays exactly as it was. Resolves false if there is no Zotero data
     * directory, true once the change is saved.
     */
    _editUserConfig(mutate) {
        const run = async () => {
            const file = await this._ensureUserDictionaryFile();
            if (!file) return false;
            const io = await this._getIOUtils();
            const current = Object.assign(this._starterUserConfig(),
                this._parseUserConfig(await io.readUTF8(file)));
            if (mutate(current) === false) return false;
            await this._writeUserConfig(io, file, current);
            return true;
        };
        const result = (this._configQueue || Promise.resolve()).then(run, run);
        this._configQueue = result.catch(() => {});
        return result;
    },

    /**
     * Write the abbreviations file through a temporary file that is then moved
     * into place, so a crash part-way through cannot leave it half-written.
     */
    async _writeUserConfig(io, file, config) {
        const text = JSON.stringify(config, null, 2);
        try {
            await io.writeUTF8(file, text, { tmpPath: file + '.tmp' });
        } catch (e) {
            this.log('Safe write failed (' + e + '); writing the file directly');
            await io.writeUTF8(file, text);
        }
    },

    /** Absolute path to the user-editable dictionary, or null if unavailable. */
    _userDictionaryPath() {
        let dataDir;
        try { dataDir = Zotero.DataDirectory && Zotero.DataDirectory.dir; } catch (e) {}
        if (!dataDir) return null;
        return this._joinPath(dataDir, 'abbreviation-helper', 'abbreviations.json');
    },

    /** Ensure the user dictionary file exists (creating it), returning its path. */
    async _ensureUserDictionaryFile() {
        const file = this._userDictionaryPath();
        if (!file) return null;
        try {
            const io = await this._getIOUtils();
            if (!(await io.exists(file))) {
                const dir = this._joinPath(Zotero.DataDirectory.dir, 'abbreviation-helper');
                await io.makeDirectory(dir, { ignoreExisting: true });
                await io.writeUTF8(file, JSON.stringify(this._starterUserConfig(), null, 2));
                this.log('Created editable user dictionary at ' + file);
            }
        } catch (e) {
            this.log('Could not ensure user dictionary file: ' + e);
        }
        return file;
    },

    /**
     * Open the user dictionary so it can be edited. Reveals it in the OS file
     * manager (most reliable for choosing an editor); falls back to launching
     * the file directly, then to showing the path.
     */
    async _openUserDictionary(window) {
        try {
            try { await this._dictionariesReady; } catch (e) {}
            const file = await this._ensureUserDictionaryFile();
            if (!file) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Could not locate the Zotero data directory to create the abbreviations file.');
                return;
            }
            try {
                // Asynchronous in every supported Zotero, so it must be awaited
                // for a failure to reach the fallbacks below.
                await Zotero.File.reveal(file);
                return;
            } catch (e) {
                this.log('reveal failed, trying launchFile: ' + e);
            }
            try {
                Zotero.launchFile(file);
                return;
            } catch (e) {
                this.log('launchFile failed: ' + e);
            }
            Zotero.alert(window, 'Abbreviation Helper',
                'Your abbreviations file is here:\n\n' + file +
                '\n\nOpen it in any text editor, add entries, then choose "Reload from file" in Settings.');
        } catch (e) {
            this.log('Could not open the abbreviations file: ' + e);
        }
    },

    /** Re-read the dictionaries from disk and refresh the active reader. */
    async _reloadDictionaries(window) {
        try {
            this._dictionariesReady = this._loadDictionaries();
            await this._dictionariesReady;
            try { this.cache.clear(); } catch (e) {}
            // The PDF text is still cached, so the open paper is re-detected
            // with the new dictionaries without being read again.
            this._setActiveHoverPairs(null, []);
            try { await this._autoScanActiveReader(); } catch (e) {}
            if (window && this.userFileError) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Your abbreviations file could not be read, so your own entries are not in use.\n\n'
                    + this.userFileError + '\n\nOpen the file, correct it, then reload it. '
                    + 'The plugin will not change the file until then.');
            } else if (window) {
                Zotero.alert(window, 'Abbreviation Helper',
                    'Abbreviations file reloaded: ' +
                    Object.keys(this.dictionaries.staticDefs).length + ' static and ' +
                    Object.keys(this.dictionaries.commonKnownDefs).length + ' glossary entries.');
            }
        } catch (e) {
            this.log('Reload failed: ' + e);
            if (window) Zotero.alert(window, 'Abbreviation Helper', 'Could not reload the abbreviations file. See the Zotero log for details.');
        }
    },

    /** Store a scan result, evicting the oldest entry past CACHE_LIMIT. */
    _cacheResult(itemID, pairs) {
        try {
            if (this.cache.has(itemID)) this.cache.delete(itemID);
            this.cache.set(itemID, pairs);
            while (this.cache.size > this.CACHE_LIMIT) {
                const oldest = this.cache.keys().next().value;
                this.cache.delete(oldest);
            }
        } catch (e) {
            this.log('Could not cache scan result: ' + e);
        }
    },

    /**
     * Write a debug message prefaced with the plugin name.
     */
    log(msg) {
        Zotero.debug("Abbreviation Helper: " + msg);
    },

    /**
     * Insert our menu item into the Tools menu of a Zotero window.
     *
     * @param {Window} window The Zotero window to modify.
     */
    /* ---- Zotero UI: Tools menu ---- */
    addToWindow(window) {
        const doc = window.document;
        try {
            const toolsPopup = doc.getElementById('menu_ToolsPopup') || doc.getElementById('menu_toolsMenuPopup');
            if (!toolsPopup) {
                this.log('Could not locate Tools menu to insert menu item');
                return;
            }
            // Startup retries and the window hooks can both register UI for the
            // same window; if the menu is already there, do nothing.
            if (doc.getElementById('abbreviation-helper-menu')) return;

            const rootMenu = doc.createXULElement('menu');
            rootMenu.id = 'abbreviation-helper-menu';
            rootMenu.setAttribute('label', 'Abbreviation Helper');
            const rootPopup = doc.createXULElement('menupopup');
            rootMenu.appendChild(rootPopup);

            /* ---- small builders so the menu below reads as a layout ---- */
            const sep = (parent) => parent.appendChild(doc.createXULElement('menuseparator'));
            const header = (parent, label) => {
                const item = doc.createXULElement('menuitem');
                item.setAttribute('label', label);
                item.setAttribute('disabled', 'true');
                item.setAttribute('style', 'font-weight: bold; opacity: 0.85;');
                return parent.appendChild(item);
            };
            /* XUL dismisses the whole menu on every command. Settings are
             * usually changed several at a time, so anything that toggles a
             * setting stays open; anything that performs an action (scan, open
             * a file) still closes, because that is what you expect after
             * asking for something to happen.
             *
             * If a Zotero build ever stops honouring `closemenu`, the menu
             * simply closes as it used to — nothing breaks. */
            const keepOpen = (item) => { item.setAttribute('closemenu', 'none'); return item; };

            const action = (parent, id, label, onCommand, stayOpen) => {
                const item = doc.createXULElement('menuitem');
                if (id) item.id = id;
                item.setAttribute('label', label);
                if (stayOpen) keepOpen(item);
                item.addEventListener('command', () => onCommand(item));
                return parent.appendChild(item);
            };
            const checkbox = (parent, id, label, checked, onCommand) => {
                const item = doc.createXULElement('menuitem');
                if (id) item.id = id;
                item.setAttribute('label', label);
                item.setAttribute('type', 'checkbox');
                item.setAttribute('checked', checked ? 'true' : 'false');
                keepOpen(item);
                item.addEventListener('command', () => onCommand(item));
                return parent.appendChild(item);
            };
            const submenu = (parent, label) => {
                const menu = doc.createXULElement('menu');
                menu.setAttribute('label', label);
                const popup = doc.createXULElement('menupopup');
                menu.appendChild(popup);
                parent.appendChild(menu);
                return popup;
            };
            /* A set of radio items sharing one group name. Returns the items
             * so a caller can enable or disable them as a block. */
            const radioGroup = (parent, groupName, choices, current, onPick) => {
                const items = [];
                for (const choice of choices) {
                    const item = doc.createXULElement('menuitem');
                    item.setAttribute('type', 'radio');
                    item.setAttribute('name', groupName);
                    item.setAttribute('label', choice.label);
                    item.setAttribute('checked', choice.id === current ? 'true' : 'false');
                    keepOpen(item);
                    item.addEventListener('command', () => onPick(choice.id, item));
                    parent.appendChild(item);
                    items.push(item);
                }
                return items;
            };

            /* ---------------------------------------------------------------
             * Layout.
             *
             * Ordered by how often something is used, not by how the code is
             * organised. What you do repeatedly (scan, the two on/off
             * switches, correcting a wrong detection) stays at the top level;
             * what you set once and forget (modifier keys, which databases,
             * tooltip appearance) lives one level down. Separators carry the
             * grouping, so no bold pseudo-headers are needed out here.
             *
             * Every reference to the settings file uses the same words \u2014
             * "abbreviations file" \u2014 because there is only one of them.
             *
             * Two shapes, chosen by the "Show every setting in the Tools menu"
             * preference. Simple (the default) is actions only, with settings
             * in the Settings window — the only place several can be changed
             * in one visit on macOS. Advanced mirrors every setting here too.
             *
             * The menu is rebuilt each time it opens rather than once at
             * startup, so switching that preference takes effect immediately
             * and every control reflects current state.
             * ------------------------------------------------------------- */
            const buildMenu = () => {
            while (rootPopup.firstChild) rootPopup.removeChild(rootPopup.firstChild);
            const advanced = !!this.advancedMenu;

            // Collected below, then greyed out together whenever the database
            // layer is switched off, so no visible control silently does
            // nothing.
            const dbDependents = [];
            const syncDbDependents = () => {
                for (const el of dbDependents) {
                    el.setAttribute('disabled', this.databaseLinksEnabled ? 'false' : 'true');
                }
            };

            /* ---- Settings ---- */
            // macOS renders this menu as a native NSMenu, which always closes
            // on selection — there is no way to keep it open while changing
            // several settings. The Settings window has no such limit, so it
            // is the recommended route and sits first.
            action(rootPopup, 'abbreviation-helper-settings', 'Settings…', () => {
                this._openSettings(window);
            });
            sep(rootPopup);

            /* ---- Scan ---- */
            action(rootPopup, 'abbreviation-helper-scan', 'Scan This PDF and Copy List', () => {
                this.scanCurrent().catch(err => {
                    this.log('Error during scan: ' + err);
                    Zotero.alert(window, 'Abbreviation Helper', 'An error occurred while scanning the PDF. See the Zotero log for details.');
                });
            });

            /* ---- What appears on hover ---- */
            if (advanced) {
            sep(rootPopup);
            checkbox(rootPopup, 'abbreviation-helper-hover',
                'Show meanings on hover', this.hoverEnabled, (item) => {
                    this.toggleHover(window, item).catch(err => {
                        this.log('Error toggling hover: ' + err);
                        Zotero.alert(window, 'Abbreviation Helper', 'Could not enable hover tooltips. See the Zotero log for details.');
                    });
                });
            checkbox(rootPopup, 'abbreviation-helper-db-enabled',
                'Show database links', this.databaseLinksEnabled, (item) => {
                    this.databaseLinksEnabled = !this.databaseLinksEnabled;
                    this._setPref('databaseLinksEnabled', this.databaseLinksEnabled);
                    item.setAttribute('checked', this.databaseLinksEnabled ? 'true' : 'false');
                    syncDbDependents();
                    this._refreshHoverFromLastState(doc);
                });

            // Both modifier settings in one place, so the difference between
            // them is visible side by side instead of split across two
            // identical-looking submenus.
            const whenPopup = submenu(rootPopup, 'When to Show\u2026');
            header(whenPopup, 'Meanings');
            radioGroup(whenPopup, 'abbrev-tooltip-mod',
                this._modifierChoices(), this.tooltipModifier, (id) => {
                    this.tooltipModifier = id;
                    this._setPref('tooltipModifier', id);
                    this._hideHoverTooltip(doc);
                });
            sep(whenPopup);
            header(whenPopup, 'Database links');
            for (const item of radioGroup(whenPopup, 'abbrev-db-mod',
                this._modifierChoices(), this.databaseLinksModifier, (id) => {
                    this.databaseLinksModifier = id;
                    this._setPref('databaseLinksModifier', id);
                    this._refreshHoverFromLastState(doc);
                })) dbDependents.push(item);
            dbDependents.push(checkbox(whenPopup, 'abbreviation-helper-db-on-abbr',
                'Also show links on defined abbreviations',
                this.databaseLinksOnAbbreviations, (item) => {
                    this.databaseLinksOnAbbreviations = !this.databaseLinksOnAbbreviations;
                    this._setPref('databaseLinksOnAbbreviations', this.databaseLinksOnAbbreviations);
                    item.setAttribute('checked', this.databaseLinksOnAbbreviations ? 'true' : 'false');
                    this._refreshHoverFromLastState(doc);
                }));
            } /* end advanced-only: hover and database settings */

            /* ---- Correcting detections ---- */
            sep(rootPopup);
            action(rootPopup, 'abbreviation-helper-ignore', 'Ignore an Abbreviation\u2026', () => {
                this._promptIgnoreAbbreviation(window).catch(err => this.log('Ignore failed: ' + err));
            });
            // Built fresh each time it opens, so it always reflects the current
            // list; clicking an entry stops ignoring it.
            const ignoredMenu = doc.createXULElement('menu');
            ignoredMenu.id = 'abbreviation-helper-ignored-menu';
            ignoredMenu.setAttribute('label', 'Ignored Abbreviations');
            const ignoredPopup = doc.createXULElement('menupopup');
            ignoredMenu.appendChild(ignoredPopup);
            rootPopup.appendChild(ignoredMenu);
            // Rebuilt on open, and again after each removal: the list stays
            // open so several entries can be cleared in one visit, which means
            // it has to redraw itself rather than leaving stale rows behind.
            const buildIgnored = () => {
                while (ignoredPopup.firstChild) ignoredPopup.removeChild(ignoredPopup.firstChild);
                const list = this._ignoreList();
                if (!list.length) {
                    const none = doc.createXULElement('menuitem');
                    none.setAttribute('label', '(none ignored)');
                    none.setAttribute('disabled', 'true');
                    ignoredPopup.appendChild(none);
                    return;
                }
                header(ignoredPopup, 'Click to stop ignoring');
                for (const abbr of list) {
                    action(ignoredPopup, null, abbr, () => {
                        this._stopIgnoring(abbr)
                            .then(() => buildIgnored())
                            .catch(e => this.log('Un-ignore failed: ' + e));
                    }, true);
                }
                sep(ignoredPopup);
                action(ignoredPopup, null, 'Stop Ignoring All', () => {
                    this._setIgnoreList([])
                        .then(() => buildIgnored())
                        .catch(e => this.log('Clear ignore list failed: ' + e));
                }, true);
            };
            ignoredPopup.addEventListener('popupshowing', buildIgnored);

            /* ---- Settings you set once ---- */
            if (advanced) {
            sep(rootPopup);
            const dbPopup = submenu(rootPopup, 'Databases');
            dbDependents.push(dbPopup.parentNode || dbPopup);
            // Rebuilt on open rather than at startup, so databases added to the
            // abbreviations file show up as soon as it is reloaded instead of
            // waiting for a Zotero restart.
            dbPopup.addEventListener('popupshowing', () => {
                while (dbPopup.firstChild) dbPopup.removeChild(dbPopup.firstChild);
                const all = (this.dictionaries && this.dictionaries.databases) || [];
                let firstGroup = true;
                for (const groupLabel of this._databaseGroups()) {
                    if (!firstGroup) sep(dbPopup);
                    firstGroup = false;
                    header(dbPopup, groupLabel);
                    for (const db of all.filter(d => (d.group || 'Databases') === groupLabel)) {
                        checkbox(dbPopup, null, db.label, this._isDatabaseOn(db), (item) => {
                            // Derive the new value from stored state, never from
                            // the item's `checked` attribute: XUL has already
                            // flipped that by the time this runs, so reading it
                            // yields the old value and the click undoes itself.
                            const nowOn = !this._isDatabaseOn(db);
                            this._setDatabaseEnabled(db.label, nowOn);
                            item.setAttribute('checked', nowOn ? 'true' : 'false');
                            this._hideHoverTooltip(doc);
                        });
                    }
                }
                if (firstGroup) {
                    const none = doc.createXULElement('menuitem');
                    none.setAttribute('label', '(none configured)');
                    none.setAttribute('disabled', 'true');
                    dbPopup.appendChild(none);
                }
                sep(dbPopup);
                action(dbPopup, null, 'Edit in Abbreviations File\u2026', () => {
                    this._openUserDictionary(window).catch(e => this.log('Open file failed: ' + e));
                });
            });

            const lookPopup = submenu(rootPopup, 'Tooltip Appearance');
            header(lookPopup, 'Text size');
            radioGroup(lookPopup, 'abbrev-font',
                // Kept in step with the same list in settings.xhtml.
                [{ id: 10, label: 'Very small' }, { id: 12, label: 'Small' },
                 { id: 14, label: 'Medium' }, { id: 16, label: 'Large' },
                 { id: 20, label: 'Very large' }],
                Number(this.tooltipFontSize), (id) => {
                    this.tooltipFontSize = id;
                    this._setPref('tooltipFontSize', id);
                    this._resetHoverTooltips();
                });
            sep(lookPopup);
            header(lookPopup, 'Theme');
            radioGroup(lookPopup, 'abbrev-theme',
                [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }],
                this.tooltipTheme, (id) => {
                    this.tooltipTheme = id;
                    this._setPref('tooltipTheme', id);
                    this._resetHoverTooltips();
                });
            } /* end advanced-only: databases and appearance */

            /* ---- The abbreviations file ---- */
            sep(rootPopup);
            action(rootPopup, 'abbreviation-helper-open-dictionary', 'Open Abbreviations File\u2026', () => {
                this._openUserDictionary(window).catch(err => {
                    this.log('Error opening abbreviations file: ' + err);
                    Zotero.alert(window, 'Abbreviation Helper', 'Could not open the abbreviations file. See the Zotero log for details.');
                });
            });
            action(rootPopup, 'abbreviation-helper-reload-dictionary', 'Reload Abbreviations File', () => {
                this._reloadDictionaries(window).catch(err => this.log('Error reloading: ' + err));
            });

            // The count is part of the label, so it is set as the menu is
            // built; every other control was just drawn from current state.
            const n = this._ignoreList().length;
            ignoredMenu.setAttribute('label',
                n ? 'Ignored Abbreviations (' + n + ')' : 'Ignored Abbreviations');
            syncDbDependents();
            }; /* end buildMenu */

            // Rebuilding on open replaces the old re-sync patching: settings
            // are shared between windows and can be changed from the Settings
            // window at any time, so the menu re-reads preferences and redraws
            // rather than trusting what it drew at startup. This is also what
            // makes the advanced toggle take effect without a restart.
            rootPopup.addEventListener('popupshowing', (event) => {
                if (event.target !== rootPopup) return;
                this._loadPrefs();
                buildMenu();
            });
            buildMenu();

            toolsPopup.appendChild(rootMenu);
            if (this.addedElementIDs.indexOf(rootMenu.id) === -1) this.addedElementIDs.push(rootMenu.id);
        } catch (e) {
            this.log('Failed to add menu item: ' + e);
        }
    },

    /**
     * Open this plugin's pane in Zotero's Settings window. Falls back to
     * opening Settings at whatever pane it defaults to, which is still more
     * useful than doing nothing.
     */
    _openSettings(window) {
        try {
            if (window && typeof window.openPreferences === 'function') {
                window.openPreferences(this._prefPaneID || undefined);
                return;
            }
            if (Zotero.Utilities && Zotero.Utilities.Internal
                && Zotero.Utilities.Internal.openPreferences) {
                Zotero.Utilities.Internal.openPreferences(this._prefPaneID || undefined);
                return;
            }
            this.log('No way to open Settings on this Zotero version');
        } catch (e) {
            this.log('Could not open Settings: ' + e);
        }
    },

    /** Current ignore list (bundled defaults plus the user's own entries). */
    _ignoreList() {
        return ((this.dictionaries && this.dictionaries.ignore) || []).slice();
    },

    /** Replace the ignore list in your file and apply it immediately. */
    async _setIgnoreList(list) {
        const unique = (list || []).filter((x, i, a) => x && a.indexOf(x) === i);
        await this._editUserConfig((c) => { c.ignore = unique; });
        await this._reloadDictionaries(null);
    },

    /**
     * Remove one entry from the ignore list in your file. Works on the file's
     * own list, so entries shipped with the plugin are never copied into it.
     */
    async _stopIgnoring(abbr) {
        await this._editUserConfig((c) => {
            const before = Array.isArray(c.ignore) ? c.ignore : [];
            const after = before.filter(x => x !== abbr);
            if (after.length === before.length) return false;
            c.ignore = after;
        });
        await this._reloadDictionaries(null);
    },

    /* ---- Editing the abbreviations file from the Settings pane ----------
     * These wrap the abbreviations file so the pane never has to know its shape,
     * so both routes to a change — pane and hand-edited JSON — end up going
     * through the same validation. */

    /** Add one short form to the ignore list. */
    async _ignoreAbbreviation(abbr) {
        const name = String(abbr || '').trim();
        if (!name) return false;
        if (this._ignoreList().indexOf(name) !== -1) return true;
        await this._editUserConfig((c) => {
            const list = Array.isArray(c.ignore) ? c.ignore : [];
            if (list.indexOf(name) !== -1) return false;
            c.ignore = list.concat([name]);
        });
        await this._reloadDictionaries(null);
        return true;
    },

    /** The user's own definitions, as a plain {short form: meaning} object. */
    _userDefinitions() {
        return Object.assign({}, (this.dictionaries && this.dictionaries.userDefs) || {});
    },

    /**
     * Add or replace one of the user's definitions. These are authoritative:
     * they override whatever the paper says.
     */
    async _setUserDefinition(abbr, term) {
        const name = String(abbr || '').trim();
        const meaning = String(term || '').trim();
        if (!name || !meaning) return false;
        await this._editUserConfig((c) => {
            c.userDefs = this._plainObject(c.userDefs);
            c.userDefs[name] = meaning;
        });
        await this._reloadDictionaries(null);
        return true;
    },

    async _removeUserDefinition(abbr) {
        let removed = false;
        await this._editUserConfig((c) => {
            const defs = this._plainObject(c.userDefs);
            if (!Object.prototype.hasOwnProperty.call(defs, abbr)) return false;
            delete defs[abbr];
            c.userDefs = defs;
            removed = true;
        });
        if (removed) await this._reloadDictionaries(null);
        return removed;
    },

    /** `v` if it is a plain object, otherwise a new empty one. */
    _plainObject(v) {
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    },

    /**
     * Ask for an abbreviation to suppress and add it to the ignore list. The
     * token last hovered is offered as the default, which is usually the
     * false positive the user just saw.
     */
    async _promptIgnoreAbbreviation(window) {
        const suggestion = this.lastHoveredToken
            || (this.lastHoverState && this.lastHoverState.token) || '';
        const value = { value: suggestion };
        let ok = false;
        try {
            ok = Services.prompt.prompt(window, 'Abbreviation Helper',
                'Never show a meaning for which abbreviation?', value, null, {});
        } catch (e) {
            this.log('Prompt unavailable: ' + e);
            Zotero.alert(window, 'Abbreviation Helper',
                'Add unwanted abbreviations to the "ignore" list in your custom abbreviations file.');
            return;
        }
        const abbr = ok && value.value ? String(value.value).trim() : '';
        if (!abbr) return;
        try {
            await this._updateUserConfig({ ignore: [abbr] });
        } catch (e) {
            this.log('Could not add to the ignore list: ' + e);
            Zotero.alert(window, 'Abbreviation Helper', this._saveFailedMessage());
            return;
        }
        await this._reloadDictionaries(null);
        Zotero.alert(window, 'Abbreviation Helper', '\u201c' + abbr + '\u201d will no longer be shown.');
    },

    /**
     * Insert UI into all currently open Zotero windows.
     */
    addToAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
        this._startAutoScanTimer();
    },

    /**
     * Remove UI from a single Zotero window.
     */
    removeFromWindow(window) {
        let doc = window.document;
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) elem.remove();
        }
    },

    /**
     * Remove UI from all open windows and clear stored element IDs.
     */
    removeFromAllWindows() {
        let windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
        this._removeHoverListeners();
        this._stopAutoScanTimer();
        this.addedElementIDs = [];
    },

    /**
     * Called first when the plugin shuts down. Marks it stopped, so a scan
     * still waiting on Zotero's PDF worker does nothing when it finishes, and
     * stops the background scan and the tab watcher.
     */
    stop() {
        this._stopped = true;
        this._stopAutoScanTimer();
        this._clearCorridor();
        this._cancelHoverHide();
    },

    /**
     * Scan a PDF for abbreviation definitions: the one open in the active
     * reader tab, or, when the library is showing, the first PDF of the
     * selected item (options.readerOnly skips the library). Unless
     * options.silent is set, the list is copied to the clipboard and a preview
     * is shown. Results are cached per item.
     */
    /* ---- Scanning and PDF text extraction ---- */
    async scanCurrent(options) {
        options = options || {};
        const info = await this._getCurrentAttachment({ readerOnly: !!options.readerOnly });
        if (!info) {
            if (!options.silent) {
                Zotero.alert(null, 'Abbreviation Helper', 'Please open a PDF in the Zotero reader or select an item with a PDF attachment.');
            }
            return;
        }
        // Ensure the full dictionary has loaded before detecting so results and
        // the per-item cache are computed with the complete dictionary.
        try { await this._dictionariesReady; } catch (e) {}
        if (this._stopped) return;
        let pairs;
        try {
            pairs = await this._pairsForItem(info.item, info.path);
        } catch (err) {
            this.log('Failed to extract text: ' + err);
            throw err;
        }
        if (this._stopped) return pairs;
        this._setActiveHoverPairs(info.item.id, pairs);
        if (this.hoverEnabled) this._installHoverForAllWindows();
        if (!options.silent) this._showDialog(pairs);
        return pairs;
    },

    /**
     * Detected pairs for an attachment, from the cache when possible. The
     * extracted text is cached separately (see textCache), so after a change
     * to the dictionaries only detection runs again, not extraction.
     */
    async _pairsForItem(item, path) {
        if (this.cache.has(item.id)) return this.cache.get(item.id);
        const text = await this._textForItem(item, path);
        const pairs = this._detectAbbreviations(text);
        this._cacheResult(item.id, pairs);
        this.log(`Scanned item ${item.id}: ${pairs.length} abbreviation definitions found.`);
        return pairs;
    },

    /** Full text of an attachment, kept for the few most recently used items. */
    async _textForItem(item, path) {
        const cached = this.textCache.get(item.id);
        if (typeof cached === 'string') {
            // Refresh its place so the least recently used text is evicted first.
            this.textCache.delete(item.id);
            this.textCache.set(item.id, cached);
            return cached;
        }
        const text = await this._extractTextForItem(item, path);
        this.textCache.set(item.id, text);
        while (this.textCache.size > this.TEXT_CACHE_LIMIT) {
            this.textCache.delete(this.textCache.keys().next().value);
        }
        return text;
    },

    /**
     * Extract the full text of a PDF attachment with Zotero's own PDF worker.
     * `Zotero.PDFWorker.getFullText(itemID)` exists in every supported version
     * (7.0 to 10) and returns { text, ... } with a form feed between pages.
     * A PDF with no text layer gives an empty string, which simply yields no
     * abbreviations.
     *
     * @param {_ZoteroTypes.Item} item Attachment item representing the PDF
     * @returns {Promise<string>} The full extracted text
     */
    async _extractTextForItem(item) {
        const worker = Zotero.PDFWorker;
        if (!worker || typeof worker.getFullText !== 'function') {
            throw new Error('Zotero.PDFWorker.getFullText is not available');
        }
        const result = await worker.getFullText(item.id);
        const text = (result && typeof result.text === 'string') ? result.text : '';
        // The detector expects continuous text, so page breaks become spaces.
        return text.replace(/\f/g, ' ');
    },

    /**
     * Item id of the attachment open in the selected reader tab, or null when
     * the library (or anything other than a reader) is selected.
     *
     * Zotero_Tabs belongs to the main window. A plugin's own scope is a
     * sandbox that does not contain it, so it is read from the window.
     */
    _activeReaderItemID() {
        let win = null;
        try { win = Zotero.getMainWindow ? Zotero.getMainWindow() : null; } catch (e) {}
        const tabs = win && win.Zotero_Tabs;
        if (!tabs || tabs.selectedType !== 'reader') return null;
        const reader = (Zotero.Reader && typeof Zotero.Reader.getByTabID === 'function')
            ? Zotero.Reader.getByTabID(tabs.selectedID) : null;
        return (reader && reader.itemID) || null;
    },

    /**
     * Find the PDF to work on and return { item, path }, or null.
     *
     * The PDF open in the active reader tab comes first. Otherwise (the
     * library is showing, or the reader holds something other than a PDF)
     * the selected item is used, unless options.readerOnly is set: the
     * attachment itself, or the first PDF of a regular item. The background
     * scan passes readerOnly, so browsing the library never triggers a scan.
     *
     * @returns {Promise<{ item: _ZoteroTypes.Item, path: string }|null>}
     */
    async _getCurrentAttachment(options) {
        options = options || {};
        try {
            const itemID = this._activeReaderItemID();
            if (itemID) {
                const found = await this._pdfAttachmentInfo(await Zotero.Items.getAsync(itemID));
                if (found) return found;
            }
        } catch (e) {
            this.log('Could not read the active reader tab: ' + e);
        }
        if (options.readerOnly) return null;

        const pane = Zotero.getActiveZoteroPane();
        if (!pane) return null;
        const sel = pane.getSelectedItems();
        if (!sel || !sel.length) return null;
        const item = sel[0];
        if (item.isAttachment && item.isAttachment()) {
            const found = await this._pdfAttachmentInfo(item);
            if (found) return found;
        }
        const attachments = item.getAttachments ? item.getAttachments() : [];
        for (const id of attachments) {
            const found = await this._pdfAttachmentInfo(await Zotero.Items.getAsync(id));
            if (found) return found;
        }
        return null;
    },

    /** { item, path } for a PDF attachment whose file path is known, else null. */
    async _pdfAttachmentInfo(att) {
        if (!att || !att.isAttachment || !att.isAttachment()) return null;
        if (!att.attachmentMIMEType || !att.attachmentMIMEType.includes('pdf')) return null;
        let path;
        if (typeof att.getFilePath === 'function') path = att.getFilePath();
        if (!path && typeof att.getFilePathAsync === 'function') {
            try { path = await att.getFilePathAsync(); } catch (e) {}
        }
        return path ? { item: att, path } : null;
    },

    /**
     * Given plain text extracted from a PDF, return an array of
     * abbreviation-definition pairs.  Patterns are designed to catch
     * common academic conventions such as "Full Term (FT)", "Full Term
     * [FT]", "Full Term, hereafter FT" and "Full Term, abbreviated as FT".
     * Short forms of 2–16 characters are considered, including mixed-case
     * ones (sgRNA, dCas9) that must align with their long form; the phases
     * are listed at the top of the function.  Only the first definition of
     * an abbreviation is kept.
     *
     * @param {string} text Text extracted from the PDF
     * @returns {Array<{ abbr: string, term: string }>}
     */
    /* ---- Abbreviation detection (Schwartz-Hearst + dictionary layers) ---- */
    _detectAbbreviations(text) {
        /*
         * Detect abbreviation/definition pairs with a local, rule-based
         * pipeline. Everything here runs offline; no external services.
         *
         * Phases, in order of decreasing evidence strength. Earlier phases win,
         * because `seen` blocks a short form once it has been claimed:
         *
         *   prepare   normalise extraction artefacts, cut the reference list,
         *             count how often each candidate short form occurs
         *   0         explicit author "Abbreviations" lists (comma-, colon- or
         *             whitespace-delimited; every list in the document)
         *   0b        comma mini-glossaries that match a curated definition
         *   A         "long form (SF)", "..., hereafter SF", "abbreviated as SF"
         *   A2        generic parenthetical scan, for long forms that
         *             themselves contain brackets
         *   A3        reverse form "SF (long form)", alignment required
         *   B         "(long form, SF)" with the expansion inside the brackets
         *   D         fallback glossary for well-known abbreviations the paper
         *             uses but never defines; ambiguous entries need contextual
         *             support and otherwise list their candidate meanings
         *
         * Acceptance is centralised in addPair(), which applies the alignment,
         * frequency, length and sanity gates.
         */
        const pairs = [];
        const seen = new Set();
        // Minimum fuzzy alignment score for a pair from a loose parenthetical
        // pattern that has no strict Schwartz-Hearst alignment. Tuned on a
        // 22-paper corpus; overridable only so the evaluation harness can sweep
        // it (see eval/sweep.js).
        const ALIGNMENT_SCORE_FLOOR = Number(
            this._alignmentFloor != null ? this._alignmentFloor : DEFAULT_ALIGNMENT_SCORE_FLOOR);

        // Cut off sections that mostly contain cited titles, journal names,
        // product codes, trial names and chemical oxidation states.
        // PDF text layers carry artefacts that silently corrupt long forms:
        // soft hyphens inside words ("fluorescence-\u00adactivated"), zero-width
        // characters, and typographic ligatures ("In\ufb01ltrating"). Normalise
        // them first, otherwise alignment breaks and terms come out truncated.
        let workingText = String(text || '')
            .replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
            .replace(/\ufb00/g, 'ff').replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl')
            .replace(/\ufb03/g, 'ffi').replace(/\ufb04/g, 'ffl')
            .replace(/\ufb05/g, 'st').replace(/\ufb06/g, 'st');
        const cutMatch = workingText.search(/\n\s*(References|Acknowledg(e)?ments|CRediT authorship contribution statement|Declaration of competing interest)\s*\n/i);
        if (cutMatch > 0) {
            workingText = workingText.slice(0, cutMatch);
        }
        const normalised = workingText.replace(/\s+/g, ' ');

        // Curated dictionary used only as a normalizer/validator for terms
        // that are locally detected in the paper. It must not add entries
        // by itself: ambiguous abbreviations such as CA, PS, RI, FI, etc.
        // are only accepted when the PDF provides local definition evidence.
        // Loaded once at startup (see _loadDictionaries); used only to
        // normalize/validate definitions the paper itself provides.
        const staticDefs = this.dictionaries.staticDefs;

        // Common fallback glossary.  These entries are deliberately kept
        // separate from staticDefs.  staticDefs only normalizes definitions
        // that the paper itself appears to define.  commonKnownDefs may add
        // a tooltip/list entry when a highly conventional abbreviation occurs
        // repeatedly but is not locally defined.  Ambiguous abbreviations
        // need context support; when multiple plausible meanings remain, the
        // tooltip shows the alternatives instead of pretending certainty.
        // Loaded once at startup (see _loadDictionaries). Fallback glossary
        // for widely-known abbreviations that a paper uses but does not define.
        const commonKnownDefs = this.dictionaries.commonKnownDefs;

        // Count short-form occurrences.  Mixed-case scientific abbreviations
        // such as ZnPC, mTHPC, Nbs and Rh are allowed.
        const abbrCounts = {};
        const abbrPattern = /\b([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)\b/g;
        let cm;
        while ((cm = abbrPattern.exec(normalised))) {
            const ab = cm[1];
            abbrCounts[ab] = (abbrCounts[ab] || 0) + 1;
        }
        // Count exact occurrences of dictionary entries that contain spaces,
        // Greek dots or parentheses and therefore are not picked up by the
        // generic abbreviation-token regex.  This rescues terms such as
        // “RPMI 1640”, “Sn(Oct)2” and “MAL-NH2⋅HCl”.
        for (const key of Object.keys(staticDefs)) {
            if (abbrCounts[key]) continue;
            try {
                const exact = new RegExp('(?:^|[^A-Za-z0-9])' + escapeRegExp(key) + '(?=$|[^A-Za-z0-9])', 'g');
                const hits = normalised.match(exact);
                if (hits && hits.length) abbrCounts[key] = hits.length;
            } catch (e) {}
        }

        for (const key of Object.keys(this.dictionaries.userDefs || {})) {
            if (abbrCounts[key]) continue;
            try {
                const exact = new RegExp('(?:^|[^A-Za-z0-9])' + escapeRegExp(key) + '(?=$|[^A-Za-z0-9])', 'g');
                const hits = normalised.match(exact);
                if (hits && hits.length) abbrCounts[key] = hits.length;
            } catch (e) {}
        }

        // Also count exact occurrences for fallback-glossary entries, many
        // of which contain lowercase prefixes, hyphens, slashes or Greek
        // symbols that the generic token regex may miss.
        for (const key of Object.keys(commonKnownDefs)) {
            if (abbrCounts[key]) continue;
            try {
                const exact = new RegExp('(?:^|[^A-Za-z0-9])' + escapeRegExp(key) + '(?=$|[^A-Za-z0-9])', 'g');
                const hits = normalised.match(exact);
                if (hits && hits.length) abbrCounts[key] = hits.length;
            } catch (e) {}
        }

        function canonicalKey(abbr) {
            if (staticDefs.hasOwnProperty(abbr)) return abbr;
            const singular = singularShortForm(abbr);
            if (singular && staticDefs.hasOwnProperty(singular)) return singular;
            return abbr;
        }
        // Proteomics papers print peptide/protein sequences in parentheses,
        // e.g. "(DLVLDVPS)" or "(VNPDPAGGPTSGRAL)".  These are not
        // abbreviations, but a generic scanner sees an uppercase token beside a
        // sentence and invents a definition for it.  They are recognised
        // structurally, not from any paper-specific list: six or more
        // characters drawn exclusively from the 20 standard amino-acid
        // one-letter codes (B, J, O, U, X and Z are deliberately absent), with
        // no digits, hyphens or lowercase.  The rule only applies in documents
        // that actually discuss peptides, and curated dictionary entries are
        // always exempt.
        const AMINO_ACID_SEQUENCE = /^[ACDEFGHIKLMNPQRSTVWY]{6,}$/;
        const documentDiscussesPeptides = /\b(?:peptides?|amino acid sequence|residues?|hydrolysates?|proteolysis)\b/i.test(normalised);
        function looksLikePeptideSequence(abbr) {
            if (!documentDiscussesPeptides) return false;
            if (staticDefs.hasOwnProperty(abbr) || commonKnownDefs.hasOwnProperty(abbr)) return false;
            return AMINO_ACID_SEQUENCE.test(abbr);
        }
        // Modern molecular-biology nomenclature is full of mixed-case short
        // forms that the classic all-caps test rejects: sgRNA, miRNA, ncRNA,
        // dCas9, CRISPRi, RNAi, ntDNA, DepMap, Inr, Pfu, Tfh. Accepting these
        // outright would also admit ordinary Title-case words, so they are
        // treated as "weak" candidates: allowed through the shape test here,
        // but required by addPair to align with their long form.
        function isValidShortForm(abbr) {
            if (!abbr || abbr.length < 2 || abbr.length > 16) return false;
            if (staticDefs.hasOwnProperty(abbr)) return true;
            if (/\s/.test(abbr)) return false;
            if (romanNumerals.includes(abbr)) return false;
            if (/^[0-9]+$/.test(abbr)) return false;
            if (isDigitLeadingChemicalShortForm(abbr)) return true;
            // Non-dictionary digit-containing tokens are often catalogue
            // numbers, cell-line identifiers or trial names (CGP55847,
            // CRL-1555, OE21). Allow compact biomedical patterns such as
            // T2D/T1D when the paper locally defines them, but reject long
            // numeric/code-like tokens.
            const compactLetterDigitLetter = /^[A-Z]\d[A-Z]s?$/.test(abbr);
            if (/^[A-Z]{1,3}-?\d{3,}/.test(abbr) && !staticDefs.hasOwnProperty(abbr)) return false; // catalogue/cell-line style
            if (/\d/.test(abbr) && !staticDefs.hasOwnProperty(abbr) && !compactLetterDigitLetter) return false;
            // Mixed-case abbreviations are common (ZnPC, mTHPC), but mixed-
            // case ordinary names such as Sigma-Aldrich should not be treated
            // as abbreviations.
            if (/[a-z]/.test(abbr) && !staticDefs.hasOwnProperty(abbr)) {
                if (!(isPluralShortForm(abbr)
                    || /^[a-z]{1,3}[A-Z0-9][A-Za-z0-9]*(?:-[A-Za-z0-9]+)?s?$/.test(abbr)
                    || /^[A-Z][a-z]{0,3}[A-Z0-9][A-Za-z0-9]*(?:-[A-Za-z0-9]+)?s?$/.test(abbr)
                    || /^[A-Z0-9]{2,}[a-z]{1,3}$/.test(abbr))) return false;
            }
            const letters = (abbr.match(/[A-Za-z]/g) || []).length;
            const uppers = (abbr.match(/[A-Z]/g) || []).length;
            if (letters < 2) return false;
            if (uppers < 2 && !staticDefs.hasOwnProperty(abbr)) return false;
            return true;
        }
        // A short form is "classic" if it passes the strict historical test.
        // Anything else may still be an abbreviation, but must prove itself by
        // aligning with its long form (see addPair).
        function isClassicShortForm(abbr) { return isValidShortForm(abbr); }
        function staticDefinitionMatchesLocalEvidence(key, localTerm, source) {
            // Explicit abbreviation lists are high-confidence local evidence.
            // We may normalize their spelling/plurals with the dictionary.
            if (source === 'abbrev-section') return true;
            if (!staticDefs.hasOwnProperty(key)) return false;
            const localFirst = firstContentWord(localTerm);
            const dictFirst = firstContentWord(staticDefs[key]);
            if (!localFirst || !dictFirst) return false;
            if (localFirst === dictFirst) return true;
            // Allow hyphen/space variation: low-density vs low density.
            const localCompact = String(localTerm).toLowerCase().replace(/[^a-z0-9]/g, '');
            const dictCompact = String(staticDefs[key]).toLowerCase().replace(/[^a-z0-9]/g, '');
            return localCompact && dictCompact && (localCompact.includes(dictCompact.slice(0, Math.min(dictCompact.length, 18))) || dictCompact.includes(localCompact.slice(0, Math.min(localCompact.length, 18))));
        }

        function shouldSkip(term, abbr) {
            const key = canonicalKey(abbr);
            if (staticDefs.hasOwnProperty(key)) return false;
            // Geographic/provider acronyms in author affiliations and supplier
            // addresses are rarely useful in the reading-assistance context and
            // create very noisy pairs such as “USA — purchased from ...”.
            if (['USA', 'UK', 'EU'].includes(abbr)) return true;
            const tokens = term.toLowerCase().split(/\s+/);
            if (tokens.some(tok => stopwords.includes(tok))) return true;
            if (/\b(cat\.?|catalog|catalogue|lane|fig\.?|table)\b/i.test(term)) return true;
            if (/\b(purchased from|obtained from|acquired from|provided by|manufactured by|distributed by)\b/i.test(term)) return true;
            return false;
        }
        function addPair(abbr, term, source, options) {
            options = options || {};
            if (source === 'abbrev-section') {
                if (!abbr || abbr.length > 40 || seen.has(abbr)) return;
            }
            else if ((!isValidShortForm(abbr) && !isWeakButPlausibleShortForm(abbr)) || seen.has(abbr)) return;
            const key = canonicalKey(abbr);
            if (key !== abbr && seen.has(key)) return;

            let cleaned = cleanTerm(term);
            if (!cleaned || cleaned.length < 2) return;

            // A definition must contain at least one real word.  This rejects
            // fragments harvested from formulas and spectra, such as “z 407”
            // picked up from “[M-H]- m/z 407”.
            if (!/[A-Za-z]{3}/.test(cleaned)) return;
            // Final backstop against runaway long forms from any pattern.  No
            // genuine expansion approaches this length (the longest curated
            // dictionary entry is 66 characters).
            if (cleaned.length > 160) return;


            // Peptide-sequence veto.  Applied at pair level so a real acronym
            // of the same shape survives when it aligns with its long form.
            // The token is blacklisted on rejection so that a later, looser
            // pattern cannot re-claim it with a worse expansion.
            if (!options.strictAligned && looksLikePeptideSequence(abbr)) {
                seen.add(abbr);
                return;
            }

            // Evidence gate for the two loose parenthetical patterns. A pair is
            // only accepted without a strict Schwartz-Hearst alignment when the
            // fuzzy alignment score is still respectable. This removes supplier
            // names, file-format labels and garbled figure text, which never
            // align with the neighbouring words. Rejected tokens are
            // blacklisted so a later, looser pattern cannot re-claim them.
            if ((source === 'outside' || source === 'paren-window' || source === 'reverse-outside')
                && !options.strictAligned && !staticDefs.hasOwnProperty(key)) {
                const weak = !isClassicShortForm(abbr);
                const score = hmmStyleScore(abbr, cleaned);
                if (weak || score < ALIGNMENT_SCORE_FLOOR) { seen.add(abbr); return; }
            }

            const hasStatic = staticDefs.hasOwnProperty(key);
            const hasLocalSupportForStatic = hasStatic && staticDefinitionMatchesLocalEvidence(key, cleaned, source);

            // Dictionary terms should normalize locally supported definitions,
            // not inject unrelated definitions. For low-evidence parenthesis
            // windows, reject the candidate when the local text does not look
            // like the dictionary definition. This fixes cases such as
            // “(PDB, 3GKI)” being read as “placed on the basis...”.
            if (hasStatic && source === 'paren-window' && !hasLocalSupportForStatic && !options.strictAligned) return;

            if (hasStatic && hasLocalSupportForStatic) {
                cleaned = staticDefs[key];
            }

            if (source === 'internal' && !hasStatic && cleaned.split(/\s+/).length < 2) return;
            if (shouldSkip(cleaned, abbr)) return;

            // A strict Schwartz-Hearst alignment is strong enough evidence on its
            // own, so a short abbreviation defined once ("Mannitol Salt agar
            // (MSA)") no longer needs a second occurrence to be accepted.
            const minCount = (hasLocalSupportForStatic || abbr.length >= 4 || options.strictAligned || source === 'internal' || source === 'abbrev-section') ? 1 : 2;
            if (source !== 'abbrev-section' && (!abbrCounts[abbr] || abbrCounts[abbr] < minCount)) return;

            seen.add(abbr);
            seen.add(key);
            // Treat singular/plural abbreviation variants as the same entry
            // for de-duplication, but keep the locally detected spelling for
            // display.  This means a paper can define either “EV (extracellular
            // vesicle)” or “EVs (extracellular vesicles)” and hovering over
            // the other number will still work.
            const singular = singularShortForm(abbr);
            if (singular) seen.add(singular);
            for (const plural of pluralShortForms(abbr)) seen.add(plural);
            pairs.push({ abbr, term: cleaned, source, confidence: source === 'abbrev-section' ? 'high' : (hasLocalSupportForStatic || options.strictAligned ? 'high' : 'medium') });
        }

        // Pattern 0: explicit abbreviation-list sections.  Many journals put
        // a compact list near the end of the first page, e.g.
        // “Abbreviations: FSR, fractional synthetic rate; BA, bile acids; ...”.
        // These lists are much more reliable than generic parenthetical
        // scanning, and they can include short forms that are not pure
        // uppercase acronyms, such as “5b reductase” or “racemase”.
        // The block is read from the un-collapsed text so the paragraph break,
        // page-break control character or copyright line that terminates the
        // footnote is still visible.  In two-column PDFs the footnote runs
        // straight into body text, and the final entry usually has no trailing
        // semicolon, so without these boundaries it swallows the rest of the
        // page (e.g. “RS, resistant starch” absorbing an entire paragraph).
        // The header may or may not carry a colon: journals print both
        // "Abbreviations: BA, bile acids; ..." and "Abbreviations A: alcalase; ...".
        // The lookahead requires a real entry to follow, so the word
        // "Abbreviations" in running prose does not trigger the parser.
        const ABBR_SECTION_RE = (/\bAbbreviations?\b[ \t]*(?:[-\u2010-\u2015:][ \t]*)?(?:The\s+abbreviations?\s+used\s+are\s*:?\s*)?\s*(?:[A-Z]\s+)?((?=[^\s:,;]{1,24}[\s:,])[\s\S]{0,2600}?)(?=\n[ \t]*\n|[\u0000-\u0008\u000B\u000C\u000E-\u001F]|\u00A9|\bC\s+\d{4}\s+[A-Z]|www\.|https?:\/\/|\bMETHODS\b|\bRESULTS\b|\bINTRODUCTION\b|\bDISCUSSION\b|\bReferences\b|\bDeclarations\b|$)/gi);
        let abbrSectionMatch;
        while ((abbrSectionMatch = ABBR_SECTION_RE.exec(workingText))) {
            const block = abbrSectionMatch[1]
                .replace(/\s+/g, ' ')
                .replace(/\b\d{2,4}\s*$/, '')
                .trim();
            for (const entry of splitAbbreviationEntries(block)) {
                const abbr = entry.abbr;
                let term = entry.term;
                // Remove parenthetical chemical names after the main long form:
                // “CA, cholic acid (3a,7a...)” -> “cholic acid”.
                term = term.replace(/\s*\([^)]{8,}\)\s*$/, '').trim();
                term = term.replace(/\s+\d{2,4}\s*$/, '').trim();
                // Safety net: bound the long form even if the block boundary
                // above was missed, so a malformed list can never produce a
                // paragraph-sized definition.
                term = trimSectionLongForm(abbr, term);
                if (!abbr || !term) continue;
                addPair(abbr, term, 'abbrev-section');
            }
        }

        // Pattern 0b: semicolon/comma mini-glossaries outside an explicit
        // “Abbreviations:” header.  Some papers define extra abbreviations
        // below a table, e.g. “GGT, gamma glutamyl transferase; ND, not
        // determined”.  Only rescue entries where the text after the comma
        // starts with the same first word as our curated definition, which
        // keeps this from treating ordinary comma clauses as definitions.
        for (const key of Object.keys(staticDefs)) {
            if (seen.has(key)) continue;
            const first = staticDefs[key].split(/[\s(–—-]+/)[0];
            if (!first || first.length < 2) continue;
            try {
                const defRe = new RegExp('(?:^|[;.]\s*)' + escapeRegExp(key) + '\s*,\s*' + escapeRegExp(first), 'i');
                if (defRe.test(normalised)) {
                    addPair(key, staticDefs[key], 'abbrev-section');
                }
            } catch (e) {}
        }

        // Pattern A: classic “long form (SF)” and “long form [SF]”.
        // The long-form window is deliberately wider than before, which helps
        // catch polymer names and receptor names, but alignment/cleanup trims it.
        const outsidePatterns = [
            /((?:[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*\s+){0,11}[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*)\s*[\(\[]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)\s*[\)\]]/g,
            /((?:[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*\s+){0,11}[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*)\s*,\s*hereafter\s+([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)/gi,
            /((?:[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*\s+){0,11}[A-Za-z0-9][A-Za-z0-9ε\-–—'’\.]*)\s*,\s*abbreviated\s+as\s+([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)/gi
        ];
        for (const re of outsidePatterns) {
            let match;
            while ((match = re.exec(normalised))) {
                const rawTerm = match[1].trim();
                const abbr = match[2].trim();
                if (!isValidShortForm(abbr) && !isWeakButPlausibleShortForm(abbr)) continue;
                const refined = refineLongForm(abbr, rawTerm);
                addPair(abbr, refined.term, 'outside', { strictAligned: refined.strictAligned });
            }
        }

        // Pattern A2: robust parenthetical scanner.  The regex above cannot
        // see definitions whose long form itself contains parentheses, such as
        // “benzyl-poly(ε-caprolactone) (PCL)” or “poly(ethylene) glycol
        // (PEG)”.  Instead of matching the long form directly, scan every
        // parenthetical chunk, treat the first comma-separated part as a short
        // form, then look backwards in the local sentence window and let the
        // alignment/dictionary logic pick the best expansion.
        const parenPattern = /\(([^()]{1,90})\)/g;
        let pm2;
        while ((pm2 = parenPattern.exec(normalised))) {
            let content = pm2[1].trim();
            let abbr = content.split(/[;,]/)[0].trim();
            // Isotope prefixes such as “1H NMR” should be normalized to the
            // reusable abbreviation “NMR”.
            if (!isValidShortForm(abbr)) {
                const isotope = abbr.match(/^[0-9]+[A-Za-z]?\s+([A-Za-z][A-Za-z0-9\-\/]{1,15})$/);
                if (isotope) abbr = isotope[1];
            }
            if (!isValidShortForm(abbr) && content.includes(',')) {
                // Also support “photosensitizer, PS” style chunks in this
                // generic scanner, while the dedicated internal pattern below
                // handles the same format more explicitly.
                const parts = content.split(',');
                abbr = parts[parts.length - 1].trim();
            }
            if (!isValidShortForm(abbr) && !isWeakButPlausibleShortForm(abbr)) continue;
            const before = normalised.slice(Math.max(0, pm2.index - 280), pm2.index).trim();
            // Prefer text after the last strong sentence boundary.  We keep
            // colons out of this list because chemical names often contain
            // colons, e.g. acyl-CoA: cholesterol acyltransferase 2.
            const b = Math.max(before.lastIndexOf('. '), before.lastIndexOf('; '), before.lastIndexOf('? '), before.lastIndexOf('! '));
            const candidate = (b >= 0 ? before.slice(b + 2) : before).trim();
            const refined = refineLongForm(abbr, candidate);
            addPair(abbr, refined.term, 'paren-window', { strictAligned: refined.strictAligned });
        }

        // Pattern A3: reverse local definitions, “SF (long form)”.
        // Many biomedical papers define a term after the short form, e.g.
        // “BFU-E (Burst Forming Unit–Erythroid)” or
        // “MEP (Megakaryocyte Erythroid Progenitor)”.  This is deliberately
        // stricter than Pattern A: we only accept the pair when the long form
        // aligns well with the short form.  That prevents ordinary explanatory
        // parentheses after words from becoming false abbreviations.
        const reverseOutsidePattern = /(?:^|[^A-Za-z0-9])([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)\s*[\(\[]\s*([A-Za-z][A-Za-z0-9ε\-–—'’\.]*\s+[A-Za-z][A-Za-z0-9ε\-–—'’\.]*[^()\[\]]{0,120}?)\s*[\)\]]/g;
        let rm;
        while ((rm = reverseOutsidePattern.exec(normalised))) {
            const abbr = rm[1].trim();
            const rawTerm = rm[2].trim();
            if (!isValidShortForm(abbr)) continue;
            // If the parenthetical content itself looks like a short-form list
            // rather than a long form, leave it to the other patterns.
            if (isValidShortForm(rawTerm)) continue;
            const refined = refineLongForm(abbr, rawTerm);
            if (!refined.strictAligned && hmmStyleScore(abbr, refined.term) < 0.95) continue;
            addPair(abbr, refined.term, 'reverse-outside', { strictAligned: refined.strictAligned });
        }

        // Pattern B: parenthetical definitions such as “(photosensitizer, PS)”
        // or “(temoporfin, mTHPC)”, where the expansion is inside the brackets.
        const internalPattern = /\(\s*([A-Za-z][A-Za-z0-9ε\-–—'’ ]{2,80}?)\s*,\s*([A-Za-z0-9][A-Za-z0-9\-\/]{1,15}s?)\s*\)/g;
        let im;
        while ((im = internalPattern.exec(normalised))) {
            addPair(im[2].trim(), im[1].trim(), 'internal');
        }

        // Pattern C intentionally omitted for now. Paired constructions
        // such as “X- and Y-targeted micelles (X-TM and Y-TM, respectively)”
        // need a general local-evidence parser; a dictionary-only rescue is
        // too paper-specific and can inject unsupported terms.

        // Pattern D: common fallback glossary.  This runs only after local
        // extraction is complete.  It does not override local definitions and
        // it never uses paper-specific rescues.  Low-ambiguity entries can be
        // added when the abbreviation appears repeatedly.  Medium/high
        // ambiguity entries require contextual support.  If more than one
        // supported meaning remains, show all supported options rather than
        // pretending certainty.
        function getContextSupport(abbr, option) {
            const ctx = option.context || [];
            if (!ctx.length) return option.ambiguity === 'low';
            const lower = normalised.toLowerCase();
            for (const c of ctx) {
                if (lower.includes(String(c).toLowerCase())) return true;
            }
            // Look near occurrences as a fallback for multi-word context that
            // may be split by PDF extraction.
            try {
                const re = new RegExp('(?:^|[^A-Za-z0-9])' + escapeRegExp(abbr) + '(?=$|[^A-Za-z0-9])', 'gi');
                let hit;
                while ((hit = re.exec(normalised))) {
                    const win = normalised.slice(Math.max(0, hit.index - 220), Math.min(normalised.length, hit.index + 220)).toLowerCase();
                    for (const c of ctx) {
                        const parts = String(c).toLowerCase().split(/\s+/).filter(Boolean);
                        if (parts.length && parts.every(part => win.includes(part))) return true;
                    }
                }
            } catch (e) {}
            return false;
        }
        function addCommonKnownPair(abbr, options) {
            if (!options || !options.length) return;
            if (seen.has(abbr)) return;
            const singular = singularShortForm(abbr);
            if (singular && seen.has(singular)) return;
            for (const plural of pluralShortForms(abbr)) {
                if (seen.has(plural)) return;
            }
            const count = abbrCounts[abbr] || 0;
            if (count < 2) return;
            const supported = [];
            for (const opt of options) {
                if (opt.ambiguity === 'low' || getContextSupport(abbr, opt)) supported.push(opt);
            }
            if (!supported.length) return;
            const terms = [];
            for (const opt of supported) {
                if (terms.indexOf(opt.term) === -1) terms.push(opt.term);
            }
            if (!terms.length) return;
            const suffix = terms.length > 1
                ? ' (common possible meanings; not explicitly defined in this paper)'
                : ' (common term; not explicitly defined in this paper)';
            const term = terms.join(' / ') + suffix;
            seen.add(abbr);
            if (singular) seen.add(singular);
            for (const plural of pluralShortForms(abbr)) seen.add(plural);
            pairs.push({ abbr, term, source: 'common-known', confidence: terms.length > 1 ? 'low' : 'medium' });
        }
        for (const key of Object.keys(commonKnownDefs)) {
            addCommonKnownPair(key, commonKnownDefs[key]);
        }

        // The user layer runs last and wins outright. A user definition is only
        // applied when the abbreviation actually occurs in this document, so an
        // unrelated personal glossary does not add noise to every paper.
        const userDefs = this.dictionaries.userDefs || {};
        for (const [abbr, term] of Object.entries(userDefs)) {
            if (!abbr || !term || !abbrCounts[abbr]) continue;
            const existing = pairs.find(p => p.abbr === abbr);
            if (existing) {
                existing.term = term;
                existing.source = 'user';
                existing.confidence = 'high';
            } else {
                pairs.push({ abbr, term, source: 'user', confidence: 'high' });
            }
        }

        const ignored = new Set(this.dictionaries.ignore || []);
        return ignored.size ? pairs.filter(p => !ignored.has(p.abbr)) : pairs;
    },

    /**
     * Copy the detected pairs to the clipboard and show a preview of the
     * first 35 in an alert. If nothing was detected, say so instead.
     *
     * @param {Array<{ abbr: string, term: string }> } pairs Array of
     * abbreviation-definition objects
     */
    _showDialog(pairs) {
        if (!pairs || !pairs.length) {
            Zotero.alert(null, 'Abbreviation Helper', 'No abbreviation definitions were detected.');
            return;
        }
        const lines = pairs.map(p => `${p.abbr} — ${p.term}`);
        const fullMessage = lines.join('\n');

        // Long Zotero alerts are hard to scroll and copy.  Always copy the
        // full abbreviation list to the system clipboard, then show only a
        // preview in the alert.  This keeps the UI usable for papers with
        // dozens of abbreviations.
        let copied = false;
        try {
            const clipboard = Components.classes['@mozilla.org/widget/clipboardhelper;1']
                .getService(Components.interfaces.nsIClipboardHelper);
            clipboard.copyString(fullMessage);
            copied = true;
        } catch (e) {
            try {
                Services.clipboard.copyString(fullMessage);
                copied = true;
            } catch (e2) {
                this.log('Could not copy abbreviations to clipboard: ' + e2);
            }
        }

        const maxLines = 35;
        let preview = lines.slice(0, maxLines).join('\n');
        if (lines.length > maxLines) {
            preview += `\n\n… ${lines.length - maxLines} more entries not shown here.`;
        }
        const header = `${pairs.length} abbreviation definitions found.` +
            (copied ? '\nFull list copied to clipboard.' : '\nFull list could not be copied automatically.');
        Zotero.alert(null, 'Abbreviation Helper', header + '\n\n' + preview);
    },


    /**
     * Enable/disable hover tooltips.  Hover integration is intentionally
     * optional because it touches the Zotero reader DOM, which is less stable
     * than the PDF text extraction and menu APIs.  When enabling, we silently
     * scan the PDF open in the reader and then attach mouse listeners to
     * reader documents that contain PDF.js text-layer spans.
     */
    /* ---- Hover tooltips in the Zotero reader ---- */
    async toggleHover(window, menuitem) {
        this.hoverEnabled = !this.hoverEnabled;
        this._setPref('hoverEnabled', this.hoverEnabled);
        if (menuitem) menuitem.setAttribute('checked', this.hoverEnabled ? 'true' : 'false');
        if (!this.hoverEnabled) {
            this._removeHoverListeners();
            return;
        }

        // Quietly scan the PDF open in the reader when hover is turned on. Do
        // not show a popup here; the scan command still shows the normal one.
        try {
            await this.scanCurrent({ silent: true, readerOnly: true });
        } catch (e) {
            this.log('Silent scan while enabling hover failed: ' + e);
        }
        this._installHoverForAllWindows();
    },

    /**
     * Start the background scan: right away when a reader tab is selected,
     * plus a check every 2.5 s as a safety net and to attach hover listeners
     * to reader pages that finish rendering later.
     */
    _startAutoScanTimer() {
        if (this.autoScanTimer) return;
        this.autoScanTimer = setInterval(() => {
            this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
        }, 2500);
        // Try once shortly after startup/window injection. Tracked so that
        // disabling the plugin within the first second cannot leave a pending
        // scan that runs after shutdown.
        this.autoScanFirstRun = setTimeout(() => {
            this.autoScanFirstRun = null;
            this._autoScanActiveReader().catch(e => this.log('Initial auto-scan failed: ' + e));
        }, 1200);
        this._watchTabs();
    },

    _stopAutoScanTimer() {
        if (this.autoScanTimer) {
            clearInterval(this.autoScanTimer);
            this.autoScanTimer = null;
        }
        if (this.autoScanFirstRun) {
            clearTimeout(this.autoScanFirstRun);
            this.autoScanFirstRun = null;
        }
        this._unwatchTabs();
        this.autoScanInProgress = false;
        this._autoScanAgain = false;
    },

    /**
     * Rescan as soon as the user switches to (or loads) a reader tab, so the
     * meanings shown always belong to the paper on screen. Zotero announces
     * tab changes through its notifier in every supported version; if this
     * cannot be set up, the 2.5 s timer still catches up.
     */
    _watchTabs() {
        if (this._tabObserverID) return;
        try {
            if (!Zotero.Notifier || typeof Zotero.Notifier.registerObserver !== 'function') return;
            this._tabObserverID = Zotero.Notifier.registerObserver({
                notify: (event, type) => {
                    if (this._stopped || type !== 'tab') return;
                    if (event !== 'select' && event !== 'load') return;
                    // Read the new tab once Zotero has finished switching to it.
                    setTimeout(() => {
                        this._autoScanActiveReader().catch(e => this.log('Auto-scan after a tab change failed: ' + e));
                    }, 100);
                }
            }, ['tab'], 'abbreviationHelper');
        } catch (e) {
            this._tabObserverID = null;
            this.log('Could not watch tab changes; relying on the timer: ' + e);
        }
    },

    _unwatchTabs() {
        try {
            if (this._tabObserverID && Zotero.Notifier && Zotero.Notifier.unregisterObserver) {
                Zotero.Notifier.unregisterObserver(this._tabObserverID);
            }
        } catch (e) {}
        this._tabObserverID = null;
    },

    /**
     * Make sure the meanings in use belong to the PDF open in the active
     * reader tab. Only the reader counts: browsing the library never starts a
     * scan. Called by the timer, on tab changes and after settings change.
     */
    async _autoScanActiveReader() {
        if (this._stopped || !this.hoverEnabled) return;
        // One scan at a time; a request that arrives meanwhile (a quick second
        // tab switch, say) runs once the current scan has finished.
        if (this.autoScanInProgress) {
            this._autoScanAgain = true;
            return;
        }
        this.autoScanInProgress = true;
        let itemID = null;
        try {
            try { await this._dictionariesReady; } catch (e) {}
            if (this._stopped) return;
            let info = null;
            try {
                info = await this._getCurrentAttachment({ readerOnly: true });
            } catch (e) {
                this.log('Could not inspect active reader for auto-scan: ' + e);
                return;
            }
            if (this._stopped || !info || !info.item) return;

            itemID = info.item.id;
            if (itemID === this.activeHoverItemID) {
                // Already showing this paper (even if it defines nothing).
                // Only attach listeners to reader pages rendered since.
                this._installHoverForAllWindows();
                return;
            }
            // A PDF that just failed (no file yet, password, …) is retried
            // after 30 s rather than on every tick.
            const failed = this._lastAutoScanFailure;
            if (failed && failed.itemID === itemID && Date.now() - failed.time < 30000) return;

            const pairs = await this._pairsForItem(info.item, info.path);
            if (this._stopped) return;
            this._lastAutoScanFailure = null;
            this._setActiveHoverPairs(itemID, pairs);
            this._installHoverForAllWindows();
        } catch (e) {
            if (itemID != null) this._lastAutoScanFailure = { itemID, time: Date.now() };
            this.log('Auto-scan extraction/detection failed: ' + e);
        } finally {
            this.autoScanInProgress = false;
            if (this._autoScanAgain && !this._stopped) {
                this._autoScanAgain = false;
                this._autoScanActiveReader().catch(e => this.log('Auto-scan failed: ' + e));
            }
        }
    },

    _setActiveHoverPairs(itemID, pairs) {
        this.activeHoverItemID = itemID;
        this.activeHoverMap = this._buildHoverMap(pairs || []);
        // The meanings changed, so the next mouse move redraws the tooltip.
        this._renderedSig = null;
        this._mapGeneration = (this._mapGeneration || 0) + 1;
    },

    _buildHoverMap(pairs) {
        const map = new Map();
        const entries = [];
        for (let pair of pairs || []) {
            if (!pair || !pair.abbr || !pair.term) continue;
            const abbr = String(pair.abbr).trim();
            const term = String(pair.term).trim();
            if (!abbr || !term) continue;
            entries.push([abbr, term]);
        }
        // Every short form exactly as detected goes in first, so a variant
        // made from one entry can never replace another entry of the paper:
        // the "Ab" variant of "Aβ" must not overwrite "Ab = antibody".
        for (const [abbr, term] of entries) map.set(abbr, term);
        const addVariant = (key, term) => {
            if (key && !map.has(key)) map.set(key, term);
        };
        for (const [abbr, term] of entries) {
            // Common PDF extraction/reader variants
            addVariant(abbr.replace(/β/g, 'b').replace(/Β/g, 'B'), term);
            addVariant(abbr.replace(/-/g, '‑'), term);
            addVariant(abbr.replace(/‑/g, '-'), term);
            // Plural handling: academic papers often define only one number
            // but use both forms while reading, e.g. “extracellular vesicles
            // (EVs)” followed by “EV”, or “extracellular vesicle (EV)”
            // followed by “EVs”.  Add both aliases to the hover map without
            // changing the detected/displayed entry.
            addVariant(this.singularShortForm(abbr), term);
            if (!abbr.endsWith('s')) {
                addVariant(abbr + 's', term);
                addVariant(abbr + 'S', term);
            }
        }
        return map;
    },

    /** The same rule the detector uses (see the singularShortForm function above). */
    singularShortForm(abbr) {
        return singularShortForm(String(abbr || ''));
    },

    /**
     * Attach hover listeners to every reader page that shows PDF text and does
     * not have them yet. Listeners stay attached while the meanings change
     * (they always read the current map), so this never tears anything down
     * and is cheap to call often.
     */
    _installHoverForAllWindows() {
        if (this._stopped || !this.hoverEnabled) return;
        if ((!this.activeHoverMap || !this.activeHoverMap.size) && !this._enabledDatabases().length) return;
        this._pruneHoverDocs();
        let windows = [];
        try { windows = Zotero.getMainWindows(); } catch (e) { windows = []; }
        for (let win of windows) {
            try { this._installHoverInWindow(win); } catch (e) { this.log('Failed to install hover in window: ' + e); }
        }
    },

    _installHoverInWindow(window) {
        const docs = this._getReaderDocuments(window);
        for (let doc of docs) {
            if (!doc || !doc.body) continue;
            if (this.hoverDocs.some(rec => rec.doc === doc)) continue;
            // Avoid attaching to Zotero chrome documents without PDF text.
            // PDF.js pages usually expose .textLayer; Zotero reader builds may
            // vary, so we also accept documents with many text-layer-ish spans.
            const hasTextLayer = !!doc.querySelector('.textLayer, .page .textLayer, [class*="textLayer"]');
            if (!hasTextLayer) continue;
            const move = (event) => this._onReaderMouseMove(doc, event);
            const out = (event) => this._onReaderMouseLeave(doc, event);
            const scroll = () => this._forgetHover(doc);
            const click = (event) => this._onReaderClick(doc, event);
            const keydown = (event) => this._onReaderKeyDown(doc, event);
            const keyup = (event) => this._onReaderKeyUp(doc, event);
            const blur = () => this._onReaderBlur(doc);
            // Key-up is listened for on the window only: it sees every key-up
            // the document does, so listening on both ran the handler twice.
            const keyTarget = doc.defaultView || doc;
            doc.addEventListener('mousemove', move, true);
            doc.addEventListener('mouseleave', out, true);
            doc.addEventListener('scroll', scroll, true);
            doc.addEventListener('click', click, true);
            doc.addEventListener('keydown', keydown, true);
            keyTarget.addEventListener('keyup', keyup, true);
            try { if (doc.defaultView) doc.defaultView.addEventListener('blur', blur, true); } catch (e) {}
            this.hoverDocs.push({ doc, move, out, scroll, click, keydown, keyup, keyTarget, blur });
        }
    },

    /** Forget reader pages that have gone away (a closed tab, a reloaded PDF). */
    _pruneHoverDocs() {
        this.hoverDocs = (this.hoverDocs || []).filter(rec => {
            try { return !!(rec.doc && rec.doc.defaultView); } catch (e) { return false; }
        });
    },

    _getReaderDocuments(window) {
        const docs = [];
        function addDoc(doc) {
            if (doc && docs.indexOf(doc) === -1) docs.push(doc);
        }
        function walkDoc(doc, depth) {
            if (!doc || depth > 3) return;
            addDoc(doc);
            let nodes = [];
            try { nodes = doc.querySelectorAll('iframe, frame, browser'); } catch (e) { nodes = []; }
            for (let node of nodes) {
                try {
                    if (node.contentDocument) walkDoc(node.contentDocument, depth + 1);
                    else if (node.contentWindow && node.contentWindow.document) walkDoc(node.contentWindow.document, depth + 1);
                } catch (e) {
                    // Cross-context reader frames may deny access. Ignore them.
                }
            }
        }
        try { walkDoc(window.document, 0); } catch (e) {}
        return docs;
    },

    _removeHoverListeners() {
        for (let rec of this.hoverDocs || []) {
            try {
                rec.doc.removeEventListener('mousemove', rec.move, true);
                rec.doc.removeEventListener('mouseleave', rec.out, true);
                rec.doc.removeEventListener('scroll', rec.scroll, true);
                if (rec.click) rec.doc.removeEventListener('click', rec.click, true);
                if (rec.keydown) rec.doc.removeEventListener('keydown', rec.keydown, true);
                if (rec.keyup) (rec.keyTarget || rec.doc).removeEventListener('keyup', rec.keyup, true);
                try { if (rec.doc.defaultView && rec.blur) rec.doc.defaultView.removeEventListener('blur', rec.blur, true); } catch (e) {}
                this._hideHoverTooltip(rec.doc);
                // Take the tooltip out of the page too, so nothing of the
                // plugin is left behind once hover is off or it is disabled.
                const tip = rec.doc.getElementById('abbreviation-helper-tooltip');
                if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
            } catch (e) {}
        }
        this.hoverDocs = [];
        this.lastHoverState = null;
    },

    _onReaderMouseMove(doc, event) {
        if (!this.hoverEnabled || this._stopped) return;
        this._updateModifierState(event);
        const x = event.clientX, y = event.clientY;

        // Over the tooltip itself. Only a tooltip with database links can be
        // under the pointer (a plain one lets the mouse pass through), and it
        // stays open so the links can be clicked.
        if (this._eventInTooltip(doc, event)) {
            this._cancelHoverHide();
            this._clearCorridor();
            return;
        }
        // On the way from the word to a tooltip with links: hold it still for
        // a moment so the pointer can reach it across other words.
        if (this._inTooltipCorridor(doc, x, y)) {
            this._cancelHoverHide();
            this._pendingHover = { doc, x, y, target: event.target || null };
            if (!this._corridorTimer) {
                this._corridorTimer = setTimeout(() => {
                    this._corridorTimer = null;
                    const p = this._pendingHover;
                    this._pendingHover = null;
                    if (p && !this._stopped) this._hoverAt(p.doc, p.x, p.y, p.target);
                }, this.CORRIDOR_MS);
            }
            return;
        }
        this._clearCorridor();
        this._hoverAt(doc, x, y, event.target || null);
    },

    /** Show, keep or hide the tooltip for whatever is under (x, y). */
    _hoverAt(doc, x, y, target) {
        const token = this._wordAtPoint(doc, x, y, target);
        if (!token) {
            this.lastHoverState = null;
            this._scheduleHoverHide(doc, 120);
            return;
        }
        this._cancelHoverHide();

        // Still on the word the tooltip already shows: only follow the
        // pointer, without rebuilding the tooltip. A tooltip with links stays
        // put so it can be reached.
        const state = this.lastHoverState;
        if (state && state.doc === doc && state.token === token && state.target === target
            && this._renderedSig === this._hoverSignature(token) && this._isHoverTooltipVisible(doc)) {
            state.x = x;
            state.y = y;
            if (!this.hoverInteractiveTooltip) this._moveHoverTooltip(doc, x, y);
            return;
        }

        this.lastHoverState = { doc, x, y, token, dbToken: undefined, term: null, target };
        this._renderHoverFromState(this.lastHoverState);
    },

    /**
     * The pointer left an element. Only leaving the reader page itself (no
     * element to go to) closes the tooltip; moving between words, or onto a
     * tooltip with links, is handled by the mouse-move handler.
     */
    _onReaderMouseLeave(doc, event) {
        if (event && event.relatedTarget) return;
        this._forgetHover(doc);
    },

    /**
     * Hide the tooltip and forget the word it was for, so pressing a modifier
     * key or changing a setting later cannot bring it back at a stale place.
     */
    _forgetHover(doc) {
        this.lastHoverState = null;
        this._hideHoverTooltip(doc);
    },

    _eventInTooltip(doc, event) {
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            return !!(tip && event && event.target && tip.contains(event.target));
        } catch (e) {
            return false;
        }
    },

    /**
     * True when (x, y) lies on the way from the hovered word to a visible
     * tooltip with links: inside the triangle from the point where the word
     * was hovered to the tooltip's near edge, widened by 24 px on each side.
     */
    _inTooltipCorridor(doc, x, y) {
        if (!this.hoverInteractiveTooltip || this.hoverPinnedDoc !== doc) return false;
        const a = this.hoverAnchor, b = this._tipBox;
        if (!a || !b || b.doc !== doc || !this._isHoverTooltipVisible(doc)) return false;
        const edgeY = (b.top >= a.y) ? b.top : b.top + b.height;
        const left = b.left - 24, right = b.left + b.width + 24;
        const side = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
        const d1 = side(x, y, a.x, a.y, left, edgeY);
        const d2 = side(x, y, left, edgeY, right, edgeY);
        const d3 = side(x, y, right, edgeY, a.x, a.y);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    },

    _clearCorridor() {
        if (this._corridorTimer) {
            clearTimeout(this._corridorTimer);
            this._corridorTimer = null;
        }
        this._pendingHover = null;
    },

    /** What the visible tooltip depends on besides position. */
    _hoverSignature(token) {
        const m = this.modifierState || {};
        return [token, !!m.shift, !!m.ctrl, !!m.alt, !!m.meta, this._mapGeneration || 0].join('|');
    },

    /** True on macOS; used only to label keys the way the platform names them. */
    _isMac() {
        try {
            if (typeof Zotero !== 'undefined' && typeof Zotero.isMac === 'boolean') return Zotero.isMac;
        } catch (e) {}
        try { return /Mac/i.test(Services.appinfo.OS || ''); } catch (e) {}
        return false;
    },

    /**
     * Modifier choices for the menu, in display order.
     *
     * On macOS the Control setting is labelled for Command, because that is the
     * key Mac users reach for and both are accepted (see _modifierSatisfied).
     * Alt is called Option on macOS.
     */
    /**
     * The gating choices, phrased to complete the heading they sit under
     * ("Meanings: Always" / "Meanings: Only while holding Shift"). The ids are
     * what gets persisted and must not change.
     */
    _modifierChoices() {
        const mac = this._isMac();
        const hold = (key) => 'Only while holding ' + key;
        return [
            { id: 'none', label: 'Always' },
            { id: 'shift', label: hold('Shift') },
            { id: 'ctrl', label: hold(mac ? '\u2318 Command (or Control)' : 'Ctrl') },
            { id: 'alt', label: hold(mac ? '\u2325 Option' : 'Alt') }
        ];
    },

    /** Record which modifiers are down, from any mouse or keyboard event. */
    _updateModifierState(event) {
        if (!event) return;
        this.modifierState = {
            shift: !!event.shiftKey,
            ctrl: !!event.ctrlKey,
            alt: !!event.altKey,
            meta: !!event.metaKey
        };
    },

    /**
     * True when the configured modifier for a feature is satisfied.
     *
     * The 'ctrl' setting accepts either Control or Command, so a single stored
     * preference behaves correctly on macOS, Windows and Linux and a synced
     * profile does not need per-platform settings.
     */
    _modifierSatisfied(which) {
        const name = String(which || 'none');
        if (name === 'none') return true;
        const m = this.modifierState || {};
        if (name === 'ctrl') return !!(m.ctrl || m.meta);
        return !!m[name];
    },

    _databaseLinksCurrentlyAllowed() {
        if (!this.databaseLinksEnabled) return false;
        return this._modifierSatisfied(this.databaseLinksModifier);
    },

    _renderHoverFromState(state) {
        if (!state || !state.doc || !state.token) return;
        const doc = state.doc;
        const token = state.token;

        if (!this._modifierSatisfied(this.tooltipModifier)) {
            this._hideHoverTooltip(doc);
            return;
        }

        // Looked up now rather than when the mouse moved, so a tooltip redrawn
        // later (a modifier key pressed, a setting changed) uses the current
        // meanings.
        const term = (this.activeHoverMap && this.activeHoverMap.size) ? this._lookupHoverTerm(token) : null;
        state.term = term;

        // The multi-word database phrase is only worked out when links may
        // actually be shown, then remembered for this word.
        const dbAllowed = this._databaseLinksCurrentlyAllowed();
        let dbInfo = null;
        if (dbAllowed) {
            if (state.dbToken === undefined) {
                state.dbToken = this._databaseLookupCandidateAtPoint(doc, state.x, state.y, state.target, token) || token;
            }
            dbInfo = this._lookupDatabaseLinks(state.dbToken || token);
        }
        const includeDbWithAbbr = !!(term && dbInfo && this.databaseLinksOnAbbreviations);

        if (term) {
            this.lastHoveredToken = token;
            this._showHoverTooltip(doc, state.x, state.y, token, term,
                { groups: includeDbWithAbbr ? dbInfo.groups : null });
            this._renderedSig = this._hoverSignature(token);
            return;
        }

        if (!dbInfo) {
            this._renderedSig = null;
            this._scheduleHoverHide(doc, 120);
            return;
        }

        this._showDatabaseTooltip(doc, state.x, state.y, dbInfo);
        this._renderedSig = this._hoverSignature(token);
    },

    _refreshHoverFromLastState(docHint) {
        const state = this.lastHoverState;
        if (state && state.doc) {
            this._renderHoverFromState(state);
        } else if (docHint) {
            this._hideHoverTooltip(docHint);
        }
    },

    /**
     * Broad database lookup token support for hover-time links.
     *
     * This is intentionally a lookup layer, not an entity resolver.  It does
     * not assert that a token is a gene, protein, or cell line; it only decides
     * whether the token is useful enough to offer database-search shortcuts.
     * Because the user already chooses the database with number shortcuts, this
     * layer can be more permissive than the abbreviation detector while still
     * avoiding obvious PDF/navigation noise.
     */
    _databaseLookupCandidateAtPoint(doc, x, y, target, baseToken) {
        // Multi-word database lookup phrases are handled by a generic
        // biomedical-name rule. This is lookup-only: it does not create new
        // abbreviation definitions and it does not assert that the phrase is a
        // resolved gene/protein. The rule deliberately requires both:
        //   1. a compact biochemical / gene-like anchor, and
        //   2. a biological head noun.
        // That keeps ordinary title-case prose from becoming database links.
        try {
            if (!doc || !target || !baseToken) return '';
            let el = target.nodeType === 1 ? target : target.parentElement;
            if (!el) return '';
            if (el.closest) {
                el = el.closest('.textLayer span, .textLayer div, span, div') || el;
            }
            const text = String(el.textContent || '').replace(/[\u2011\u2013\u2014]/g, '-');
            if (!text || text.length > 600) return '';
            const cleanBase = this._cleanDatabaseLookupToken(baseToken, 64);
            if (!cleanBase) return '';

            const re = this._dbPhraseRegex();
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(text))) {
                const phrase = String(m[0] || '').replace(/\s+/g, ' ').trim();
                if (!this._isPlausibleBiomoleculeLookupPhrase(phrase)) continue;
                const parts = phrase.split(/[\s\-]+/).filter(Boolean);
                if (parts.some(p => p === cleanBase || p.replace(/[.,;:]+$/,'') === cleanBase)) return phrase;
            }
        } catch (e) {}
        return '';
    },

    /**
     * The multi-word lookup phrase pattern, built once.
     *
     * Keep phrase lookup narrow.  The previous version allowed normal
     * lowercase words before and after the biological phrase, so hovering
     * near "HMG CoA synthase" could produce "enzyme HMG CoA synthase
     * in the".  Here the phrase must start with a code-like/biochemical
     * anchor and end at a biological head noun.  This catches terms such
     * as "HMG CoA synthase" without swallowing surrounding prose.
     *
     * It has the g flag, so callers reset lastIndex before using it.
     */
    _dbPhraseRegex() {
        if (!this._dbPhraseRe) {
            const bioHeadNouns = this._bioLookupHeadNouns().join('|');
            const anchorWord = '(?:[A-Z]{2,10}|[A-Z]+\\d+[A-Za-z0-9]*|[A-Z][a-z]{1,4}[A-Z][A-Za-z0-9]{0,8}|[A-Z]{1,4}[αβγδκ][A-Za-z0-9-]*|[αβγδκ][A-Za-z0-9-]*|CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)';
            const midWord = '(?:' + anchorWord + '|[A-Z][a-z]{1,20}|[a-z]{2,20})';
            this._dbPhraseRe = new RegExp('\\b' + anchorWord + '(?:[ \\-]+(?:' + midWord + ')){0,4}[ \\-]+(?:' + bioHeadNouns + ')\\b', 'g');
        }
        return this._dbPhraseRe;
    },

    /** Whole-word match for a biological head noun, built once. */
    _bioNounRegex() {
        if (!this._bioNounRe) {
            this._bioNounRe = new RegExp('^(?:' + this._bioLookupHeadNouns().join('|') + ')$', 'i');
        }
        return this._bioNounRe;
    },

    _bioLookupHeadNouns() {
        return [
            'synthase','reductase','kinase','phosphatase','transferase','dehydrogenase',
            'hydrogenase','oxidase','oxygenase','peroxidase','hydrolase','ligase',
            'isomerase','carboxylase','decarboxylase','polymerase','protease','peptidase',
            'nuclease','endonuclease','exonuclease','methylase','demethylase','acetylase',
            'deacetylase','receptor','transporter','channel','pump','protein','factor',
            'enzyme','subunit','complex','pathway','domain','motif','isoform','homolog',
            'ortholog','paralog','transcript','gene','oncogene','antigen','cytokine',
            'chemokine','integrin','cadherin','selectin','lectin','globulin','collagen'
        ];
    },

    _isPlausibleBiomoleculeLookupPhrase(phrase) {
        if (!phrase) return false;
        const p = String(phrase).replace(/[\u2011\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
        if (p.length < 7 || p.length > 90) return false;
        const parts = p.split(/[\s\-]+/).filter(Boolean);
        if (parts.length < 2 || parts.length > 9) return false;

        const blocked = new Set(['FIGURE','TABLE','METHOD','METHODS','RESULT','RESULTS','SUPPLEMENTARY','MATERIALS','INTRODUCTION','DISCUSSION','REFERENCES','AUTHOR','AUTHORS','ARTICLE','ABSTRACT']);
        if (parts.some(t => blocked.has(t.toUpperCase()))) return false;

        // Code-like / biochemical anchors. This is intentionally generic:
        // uppercase roots, gene-like mixed-case symbols, digit-bearing symbols,
        // Greek-letter markers, and recurring biochemical cofactor names.
        const anchorRe = /^(?:[A-Z]{2,10}|[A-Z]+\d+[A-Za-z0-9]*|[A-Z][a-z]{1,4}[A-Z][A-Za-z0-9]{0,8}|[A-Z]{1,4}[αβγδκ][A-Za-z0-9-]*|[αβγδκ][A-Za-z0-9-]*|CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)$/;
        // Multi-word lookup phrases must be anchored at the start, not merely
        // contain an uppercase token somewhere in the middle. This prevents
        // surrounding prose such as "enzyme ... in the" from being captured.
        if (!anchorRe.test(parts[0])) return false;

        // Biological head nouns. The phrase should end at the head noun, again
        // to avoid swallowing nearby lowercase text after the useful term.
        if (!this._bioNounRegex().test(parts[parts.length - 1])) return false;

        // Require the phrase to include at least one lowercase-containing word
        // or a biochemical cofactor. This filters out runs of pure capitals.
        const hasReadableWord = parts.some(t => /[a-z]/.test(t) || /^(?:CoA|NADH?|NADPH?|FADH?|ATP|ADP|AMP|GTP|GDP|cAMP|cGMP)$/.test(t));
        if (!hasReadableWord) return false;

        return true;
    },

    /* ---- External database lookup links ---- */
    /** Databases from the abbreviations file, minus any switched off. */
    _enabledDatabases() {
        // The master switch short-circuits everything downstream: link lookup,
        // the tooltip section, and the hover listener's early-out.
        if (!this.databaseLinksEnabled) return [];
        const all = (this.dictionaries && this.dictionaries.databases) || [];
        return all.filter(d => d && this._isDatabaseOn(d));
    },

    /**
     * Whether one database is currently on. The menu is authoritative: an
     * explicit choice made there outranks the `enabled` flag in the file, so
     * a database shipped as `enabled: false` can still be switched on rather
     * than being a checkbox that does nothing.
     */
    _isDatabaseOn(db) {
        if (!db || !db.label) return false;
        if (this._disabledDatabaseLabels().has(db.label)) return false;
        if (this._enabledDatabaseLabels().has(db.label)) return true;
        return db.enabled !== false;
    },

    /** Labels switched off via the Tools menu (persisted as a preference). */
    _disabledDatabaseLabels() {
        return this._labelSet('disabledDatabases');
    },

    /** Labels switched on via the Tools menu, overriding the file's default. */
    _enabledDatabaseLabels() {
        return this._labelSet('enabledDatabases');
    },

    _labelSet(pref) {
        const raw = String(this._getPref(pref, '') || '');
        return new Set(raw.split('|').map(x => x.trim()).filter(Boolean));
    },

    _setDatabaseEnabled(label, enabled) {
        // Both lists are maintained so the two prefs can never disagree.
        const off = this._disabledDatabaseLabels();
        const on = this._enabledDatabaseLabels();
        if (enabled) { off.delete(label); on.add(label); }
        else { on.delete(label); off.add(label); }
        this._setPref('disabledDatabases', [...off].join('|'));
        this._setPref('enabledDatabases', [...on].join('|'));
    },

    /** Distinct group names, in the order they appear in the config. */
    _databaseGroups() {
        const all = (this.dictionaries && this.dictionaries.databases) || [];
        const seen = [];
        for (const d of all) {
            const g = d.group || 'Databases';
            if (seen.indexOf(g) === -1) seen.push(g);
        }
        return seen;
    },

    _lookupDatabaseLinks(word) {
        const token = this._cleanDatabaseLookupToken(word, 80);
        if (!token) return null;
        const isPhrase = /\s/.test(token);
        if (isPhrase) {
            if (!this._isPlausibleBiomoleculeLookupPhrase(token)) return null;
        } else if (!this._isPlausibleDatabaseLookupToken(token, token)) {
            return null;
        }

        // Greek letters have no place in a URL query; transliterate them.
        const searchToken = token
            .replace(/[\u03b1\u0391]/g, 'A').replace(/[\u03b2\u0392]/g, 'B')
            .replace(/[\u03b3\u0393]/g, 'G').replace(/[\u03b4\u0394]/g, 'D');
        const q = encodeURIComponent(searchToken.replace(/-/g, ''));
        const qRaw = encodeURIComponent(searchToken);
        const expand = (url) => String(url).replace(/\{q\}/g, q).replace(/\{raw\}/g, qRaw);

        const enabled = this._enabledDatabases();
        if (!enabled.length) return null;

        const groups = [];
        for (const groupLabel of this._databaseGroups()) {
            const links = enabled
                .filter(d => (d.group || 'Databases') === groupLabel)
                .map(d => ({ label: d.label, url: expand(d.url) }));
            if (links.length) groups.push({ symbol: token, search: searchToken, note: 'database lookup candidate', groupLabel, links });
        }
        if (!groups.length) return null;
        return { symbol: token, search: searchToken, groups };
    },

    _cleanDatabaseLookupToken(word, maxLen) {
        let token = String(word || '').trim()
            .replace(/^[\s\(\[\{<"'“‘]+/, '')
            .replace(/[\s\)\]\}>"'”’.,;:]+$/, '')
            .replace(/[‑–—]/g, '-');
        if (!token) return '';

        // Remove common biomedical prose affixes only for lookup.  This means
        // anti-EGFR, EGFR-specific, and A549-derived all search the base token.
        const prefix = token.match(/^(anti|non)-(.+)$/i);
        if (prefix) token = prefix[2];
        const suffix = token.match(/^(.+)-(specific|mediated|dependent|independent|induced|responsive|associated|related|derived|targeted|targeting|expressing|positive|negative|binding|bound|deficient|enriched|depleted|like|based|infected|treated)$/i);
        if (suffix) token = suffix[1];

        token = token.replace(/^[\s\(\[\{<"'“‘]+/, '')
            .replace(/[\s\)\]\}>"'”’.,;:]+$/, '');
        if (!token || token.length < 2 || token.length > (maxLen || 32)) return '';
        return token;
    },

    _isPlausibleDatabaseLookupToken(symbol, original) {
        if (!symbol) return false;
        const raw = String(original || symbol).trim();
        const normalized = raw.replace(/[‑–—]/g, '-');
        const compact = normalized.replace(/[-_.]/g, '');
        if (compact.length < 3 || compact.length > 32) return false;

        // Only uppercase/code-like or digit-bearing biomedical symbols should
        // trigger database lookup.  This intentionally rejects normal title-case
        // words such as Cholesterol, Surface, Introduction, Materials, etc. It
        // accepts all-caps/digit tokens such as TP53, A549, EDTA, 4-HNE, IL-6,
        // CD63, RAW264.7, and mixed-case gene/cell-line symbols with digits such
        // as MyD88, Huh7, and HepG2.
        const upperCodeLike = /^[A-Z0-9αβγδΑΒΓΔ][A-Z0-9αβγδΑΒΓΔ\-_.]{2,31}$/.test(normalized);
        const mixedDigitCodeLike = /^[A-Z][A-Za-z]{1,12}[\-_.]?[0-9][A-Za-z0-9\-_.]{0,16}$/.test(normalized);
        if (!upperCodeLike && !mixedDigitCodeLike) return false;
        if (!/[A-ZαβγδΑΒΓΔ]/.test(normalized)) return false;

        const blocked = new Set([
            'THE','AND','FOR','WITH','FROM','THIS','THAT','THEN','WHEN','WHERE','WHICH','ALSO','INTO','ONTO','OVER','UNDER','BETWEEN','AFTER','BEFORE','THESE','THOSE','SUCH','USING','USED','SHOW','SHOWS','DATA','RESULT','RESULTS','METHOD','METHODS','TABLE','FIG','FIGURE','PAGE','VOL','NO','DOI','HTTP','HTTPS','PDF','HTML','USA','UK','EU','MDPI','ELSEVIER','SPRINGER','WILEY','NATURE','SCIENCE'
        ]);
        if (blocked.has(compact.toUpperCase())) return false;

        // Reject plain section/page codes and bare numbers.
        if (/^\d+$/.test(compact)) return false;
        if (/^P\d+$/i.test(compact)) return false;

        return true;
    },

    _lookupHoverTerm(word) {
        if (!word) return null;
        const candidates = [];
        let cleaned = String(word).trim()
            .replace(/^[\s\(\[\{<"'“‘]+/, '')
            .replace(/[\s\)\]\}>"'”’.,;:]+$/, '');
        if (!cleaned) return null;
        candidates.push(cleaned);
        candidates.push(cleaned.replace(/‑/g, '-'));
        candidates.push(cleaned.replace(/β/g, 'b').replace(/Β/g, 'B'));
        candidates.push(cleaned.replace(/–|—/g, '-'));

        // Direct match: the hovered token is exactly a known abbreviation.
        for (let c of candidates) {
            if (this.activeHoverMap.has(c)) return this.activeHoverMap.get(c);
        }

        // Affixed abbreviation match.  Academic PDFs often contain a known
        // abbreviation inside a larger hyphenated modifier, e.g. “anti-EGFR”,
        // “EV-specific”, “T2D-associated”, or “miRNA-mediated”.  Do not add
        // these forms to the detected abbreviation list.  At hover time, only
        // interpret them when the base abbreviation is already known from the
        // current paper or the high-confidence fallback glossary.  This keeps
        // the feature useful without making abbreviation detection less
        // precise.
        const getBaseTerm = (base) => {
            if (!base) return null;
            const baseCandidates = [
                base,
                base.replace(/‑/g, '-'),
                base.replace(/–|—/g, '-'),
                base.replace(/β/g, 'b').replace(/Β/g, 'B')
            ];
            for (let b of baseCandidates) {
                if (this.activeHoverMap.has(b)) return this.activeHoverMap.get(b);
            }
            return null;
        };

        const composeSuffix = (suffix, term) => {
            suffix = String(suffix || '').toLowerCase();
            if (suffix === 'specific') return `specific to ${term}`;
            if (suffix === 'mediated') return `mediated by ${term}`;
            if (suffix === 'dependent') return `dependent on ${term}`;
            if (suffix === 'independent') return `independent of ${term}`;
            if (suffix === 'induced') return `induced by ${term}`;
            if (suffix === 'responsive') return `responsive to ${term}`;
            if (suffix === 'associated') return `associated with ${term}`;
            if (suffix === 'related') return `related to ${term}`;
            if (suffix === 'derived') return `derived from ${term}`;
            if (suffix === 'targeted') return `${term}-targeted`;
            if (suffix === 'targeting') return `targeting ${term}`;
            if (suffix === 'expressing') return `expressing ${term}`;
            if (suffix === 'positive') return `${term}-positive`;
            if (suffix === 'negative') return `${term}-negative`;
            if (suffix === 'binding') return `binding ${term}`;
            if (suffix === 'bound') return `bound to ${term}`;
            if (suffix === 'deficient') return `deficient in ${term}`;
            if (suffix === 'enriched') return `enriched in ${term}`;
            if (suffix === 'depleted') return `depleted of ${term}`;
            return `${term}-${suffix}`;
        };

        const safeSuffixes = new Set([
            'specific', 'mediated', 'dependent', 'independent', 'induced',
            'responsive', 'associated', 'related', 'derived', 'targeted',
            'targeting', 'expressing', 'positive', 'negative', 'binding',
            'bound', 'deficient', 'enriched', 'depleted'
        ]);

        for (let c of candidates) {
            // Prefix forms: anti-X and non-X.  These are treated only if X is
            // already a known abbreviation.  We intentionally keep the prefix
            // list short because broad prefixes such as “pre-” or “post-” can
            // be ordinary words rather than abbreviation modifiers.
            let prefixMatch = c.match(/^(anti|non)[-‑–—](.+)$/i);
            if (prefixMatch) {
                const prefix = prefixMatch[1].toLowerCase();
                const base = prefixMatch[2];
                const baseTerm = getBaseTerm(base);
                if (baseTerm) {
                    return prefix === 'anti' ? `anti–${baseTerm}` : `non-${baseTerm}`;
                }
            }

            // Suffix forms: X-specific, X-mediated, etc.  Only accept suffixes
            // from a small, explicit list and only if X is already known.
            let suffixMatch = c.match(/^(.+)[-‑–—]([A-Za-z]+)$/);
            if (suffixMatch) {
                const base = suffixMatch[1];
                const suffix = suffixMatch[2];
                if (safeSuffixes.has(suffix.toLowerCase())) {
                    const baseTerm = getBaseTerm(base);
                    if (baseTerm) return composeSuffix(suffix, baseTerm);
                }
            }
        }
        return null;
    },

    _wordAtPoint(doc, x, y, target) {
        const tokenChars = /[A-Za-z0-9βΒαΑγΓδΔεΕζΖηΗθΘκΚλΛμΜνΝξΞπΠρΡσΣτΤυΥφΦχΧψΨωΩ\-‑–—⋅·.\/]/;

        function tokenBounds(text, offset) {
            if (!text) return null;
            offset = Math.max(0, Math.min(offset == null ? 0 : offset, text.length));
            let start = offset;
            let end = offset;
            while (start > 0 && tokenChars.test(text[start - 1])) start--;
            while (end < text.length && tokenChars.test(text[end])) end++;
            const token = text.slice(start, end);
            if (!token) return null;
            return { token, start, end };
        }

        // PDF.js/Zotero text layers sometimes return the nearest text node even
        // when the cursor is in blank space on the page.  Without a geometry
        // check, that can make one abbreviation appear everywhere on a page.
        // Accept a caret-derived token only when the token's actual rendered
        // range is under the mouse pointer.
        function pointInTokenRange(node, start, end, x, y) {
            try {
                const range = doc.createRange();
                range.setStart(node, start);
                range.setEnd(node, end);
                const rects = range.getClientRects ? range.getClientRects() : [];
                for (let rect of rects) {
                    // A small tolerance helps with PDF text-layer quirks and
                    // subpixel positioning, but still rejects whole-page hits.
                    const padX = 3;
                    const padY = 4;
                    if (x >= rect.left - padX && x <= rect.right + padX &&
                        y >= rect.top - padY && y <= rect.bottom + padY) {
                        return true;
                    }
                }
            } catch (e) {}
            return false;
        }

        function tokenFromCaretNode(node, offset) {
            if (!node || node.nodeType !== 3) return '';
            const tb = tokenBounds(node.nodeValue, offset);
            if (!tb || !tb.token) return '';
            if (!pointInTokenRange(node, tb.start, tb.end, x, y)) return '';
            return tb.token;
        }

        try {
            if (doc.caretPositionFromPoint) {
                const pos = doc.caretPositionFromPoint(x, y);
                const tok = pos ? tokenFromCaretNode(pos.offsetNode, pos.offset) : '';
                if (tok) return tok;
            }
            if (doc.caretRangeFromPoint) {
                const range = doc.caretRangeFromPoint(x, y);
                const tok = range ? tokenFromCaretNode(range.startContainer, range.startOffset) : '';
                if (tok) return tok;
            }
        } catch (e) {}

        // Fallback for PDF.js text-layer spans.  Keep this deliberately narrow:
        // only inspect the small text-bearing element directly under the cursor,
        // not the whole page or textLayer container.  The older broad fallback
        // could scan a full page; if there was exactly one abbreviation on that
        // page, it appeared no matter where the cursor was.
        try {
            const pointEl = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null;
            let el = pointEl || (target && target.nodeType === 1 ? target : (target && target.parentElement));
            const original = el;
            while (el && el !== doc.body) {
                const text = (el.textContent || '').trim();
                const cls = String(el.className || '');
                const isContainer = /(^|\s)(page|textLayer|annotationLayer|canvasWrapper)(\s|$)/.test(cls) ||
                    /textLayer|annotationLayer|page/.test(cls);
                const hasDirectText = Array.prototype.some.call(el.childNodes || [], n => n.nodeType === 3 && n.nodeValue && n.nodeValue.trim());
                const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                const underPoint = rect && x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 3 && y <= rect.bottom + 3;

                if (text && !isContainer && hasDirectText && underPoint && text.length <= 120) {
                    const tokens = text.match(/[A-Za-z0-9βΒαΑγΓ][A-Za-z0-9βΒαΑγΓ\-‑–—⋅·.\/]{1,30}/g) || [];
                    const hits = tokens.filter(t => {
                        const hasAbbrev = this.activeHoverMap && this.activeHoverMap.size && !!this._lookupHoverTerm(t);
                        const hasDatabaseLink = !!this._lookupDatabaseLinks(t);
                        return hasAbbrev || hasDatabaseLink;
                    });
                    if (hits.length === 1) return hits[0];
                }

                // If the cursor started inside a high-level page/textLayer
                // container, do not climb and inspect the whole container text.
                if (el === original && isContainer) break;
                el = el.parentElement;
            }
        } catch (e) {}
        return '';
    },

    _showHoverTooltip(doc, x, y, abbr, term, options) {
        const tip = this._ensureHoverTooltip(doc);
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        this.activeGeneLinks = [];

        const main = doc.createElement('div');
        const strong = doc.createElement('strong');
        strong.textContent = String(abbr || '');
        main.appendChild(strong);
        main.appendChild(doc.createTextNode(' — ' + String(term || '')));
        tip.appendChild(main);

        const groups = (options && options.groups) || null;
        const interactive = !!(groups && groups.length);
        tip.dataset.abbreviationHelperInteractive = interactive ? 'true' : 'false';
        // A tooltip with links must receive clicks; a plain one must not, so
        // it never gets in the way of hovering or selecting the text below.
        tip.style.pointerEvents = interactive ? 'auto' : 'none';
        this.hoverInteractiveTooltip = interactive;
        for (const g of groups || []) this._appendDatabaseLinks(doc, tip, g);

        this._positionHoverTooltip(doc, tip, x, y);
    },

    _showDatabaseTooltip(doc, x, y, info) {
        const groups = (info && info.groups) || [];
        if (!groups.length) return;
        const tip = this._ensureHoverTooltip(doc);
        while (tip.firstChild) tip.removeChild(tip.firstChild);
        this.activeGeneLinks = [];

        const main = doc.createElement('div');
        const strong = doc.createElement('strong');
        strong.textContent = info.symbol || info.search || '';
        main.appendChild(strong);
        main.appendChild(doc.createTextNode(' \u2014 ' + (info.note || 'possible database match')));
        tip.appendChild(main);
        tip.dataset.abbreviationHelperInteractive = 'true';
        tip.style.pointerEvents = 'auto';
        this.hoverInteractiveTooltip = true;
        for (const g of groups) this._appendDatabaseLinks(doc, tip, g);
        this._positionHoverTooltip(doc, tip, x, y);
    },

    _appendDatabaseLinks(doc, tip, info) {
        const line = doc.createElement('div');
        line.style.marginTop = '4px';
        line.style.fontSize = '11px';
        line.style.opacity = '0.98';
        const groupLabel = (info && info.groupLabel) ? info.groupLabel : 'Gene/protein databases';
        line.appendChild(doc.createTextNode(groupLabel + ': '));
        const links = (info && info.links) || [];
        const startIndex = this.activeGeneLinks ? this.activeGeneLinks.length : 0;
        this.activeGeneLinks = (this.activeGeneLinks || []).concat(links).slice(0, 9);
        links.forEach((link, idx) => {
            if (idx) line.appendChild(doc.createTextNode(' | '));
            const a = doc.createElement('a');
            a.textContent = String(startIndex + idx + 1) + ': ' + link.label;
            a.href = link.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.color = this.tooltipTheme === 'light' ? '#0b5fbf' : '#9ecbff';
            a.style.textDecoration = 'underline';
            a.addEventListener('click', (event) => {
                event.stopPropagation();
                try {
                    if (typeof Zotero !== 'undefined' && Zotero.launchURL) {
                        event.preventDefault();
                        this._openExternalURL(link.url);
                    }
                } catch (e) {}
            });
            line.appendChild(a);
        });
        tip.appendChild(line);
    },

    _ensureHoverTooltip(doc) {
        let tip = doc.getElementById('abbreviation-helper-tooltip');
        // A tooltip made by another copy of the plugin (an earlier version
        // still open in a reader tab after an update) carries that copy's
        // event handlers and look, so it is replaced rather than reused.
        if (tip && tip.dataset && tip.dataset.abbreviationHelperOwner !== this._instanceToken) {
            if (tip.parentNode) tip.parentNode.removeChild(tip);
            tip = null;
        }
        if (!tip) {
            tip = doc.createElement('div');
            tip.id = 'abbreviation-helper-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.style.position = 'fixed';
            tip.style.zIndex = '2147483647';
            tip.style.maxWidth = '480px';
            tip.style.padding = '6px 8px';
            tip.style.borderRadius = '6px';
            const light = this.tooltipTheme === 'light';
            tip.style.background = light ? 'rgba(252, 252, 252, 0.98)' : 'rgba(32, 33, 36, 0.96)';
            tip.style.color = light ? '#1a1a1a' : 'white';
            tip.style.border = light ? '1px solid rgba(0,0,0,.18)' : 'none';
            // Font stack covers macOS, Windows and the common Linux defaults.
            tip.style.font = Number(this.tooltipFontSize || 12) + 'px -apple-system, BlinkMacSystemFont, '
                + '"Segoe UI", Cantarell, Ubuntu, "Liberation Sans", "DejaVu Sans", sans-serif';
            tip.style.lineHeight = '1.35';
            tip.style.boxShadow = '0 2px 8px rgba(0,0,0,.35)';
            // The mouse passes through by default. A tooltip with database
            // links switches this to 'auto' when shown (see _showHoverTooltip)
            // so its links can be clicked; the handlers below then keep it
            // open while the pointer is over it.
            tip.style.pointerEvents = 'none';
            tip.style.whiteSpace = 'normal';
            tip.dataset.abbreviationHelperOwner = this._instanceToken;
            tip.addEventListener('mouseenter', () => {
                this._cancelHoverHide();
            });
            tip.addEventListener('mouseleave', () => {
                this._scheduleHoverHide(doc, 250);
            });
            doc.body.appendChild(tip);
        }
        return tip;
    },

    _positionHoverTooltip(doc, tip, x, y) {
        this._cancelHoverHide();
        this.hoverPinnedDoc = doc || null;
        tip.style.display = 'block';
        const margin = 14;
        let left = x + margin;
        let top = y + margin;
        const vw = doc.defaultView ? doc.defaultView.innerWidth : 1000;
        const vh = doc.defaultView ? doc.defaultView.innerHeight : 800;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        const rect = tip.getBoundingClientRect();
        if (rect.right > vw - 8) left = Math.max(8, x - rect.width - margin);
        if (rect.bottom > vh - 8) top = Math.max(8, y - rect.height - margin);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        // Remembered so the tooltip can follow the pointer without measuring
        // it again, and so the way to a tooltip with links can be recognised.
        this._tipBox = { doc, left, top, width: rect.width, height: rect.height };
        this.hoverAnchor = { x, y };
    },

    /**
     * Follow the pointer across the same word, using the size measured when
     * the tooltip was drawn, so no layout has to be recalculated.
     */
    _moveHoverTooltip(doc, x, y) {
        const b = this._tipBox;
        if (!b || b.doc !== doc) return;
        let tip = null;
        try { tip = doc.getElementById('abbreviation-helper-tooltip'); } catch (e) {}
        if (!tip) return;
        const margin = 14;
        const vw = doc.defaultView ? doc.defaultView.innerWidth : 1000;
        const vh = doc.defaultView ? doc.defaultView.innerHeight : 800;
        let left = x + margin;
        let top = y + margin;
        if (left + b.width > vw - 8) left = Math.max(8, x - b.width - margin);
        if (top + b.height > vh - 8) top = Math.max(8, y - b.height - margin);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
        b.left = left;
        b.top = top;
        this.hoverAnchor = { x, y };
    },

    _isHoverTooltipVisible(doc) {
        try {
            const tip = doc && doc.getElementById ? doc.getElementById('abbreviation-helper-tooltip') : null;
            return !!(tip && tip.style.display !== 'none');
        } catch (e) {
            return false;
        }
    },

    _onReaderClick(doc, event) {
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            if (tip && event.target && tip.contains(event.target)) {
                // Allow database links to receive the click.  Do not hide here;
                // the link handler may call Zotero.launchURL.
                this._cancelHoverHide();
                return;
            }
        } catch (e) {}
        // Clicking anywhere else dismisses interactive link tooltips.  This is
        // what prevents sticky gene/protein tooltips from lingering forever,
        // while abbreviation-only hover tooltips keep their normal behavior.
        if (this.hoverInteractiveTooltip) this._forgetHover(doc);
    },

    _onReaderKeyDown(doc, event) {
        if (!event) return;
        if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
            this._updateModifierState(event);
            // The pressed key is not yet reflected in the event flags.
            const map = { Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'meta' };
            this.modifierState[map[event.key]] = true;
            this._refreshHoverFromLastState(doc);
            return;
        }
        if (event.key === 'Escape') {
            this._forgetHover(doc);
            return;
        }

        // Number shortcuts are deliberately limited to interactive
        // gene/protein-link tooltips.  Abbreviation-only tooltips keep their
        // normal hover behavior and do not capture keys.  This gives users a
        // reliable way to open database links even when the Zotero reader DOM
        // makes the tooltip hard to click.
        if (!this.hoverInteractiveTooltip || !this._isHoverTooltipVisible(doc)) return;
        if (!/^[1-9]$/.test(String(event.key || ''))) return;

        // Do not intercept number typing inside text fields, search boxes,
        // annotation editors, or contenteditable elements.
        try {
            const target = event.target;
            const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (target && target.isContentEditable) return;
        } catch (e) {}

        const idx = parseInt(event.key, 10) - 1;
        const link = this.activeGeneLinks && this.activeGeneLinks[idx];
        if (!link || !link.url) return;

        event.preventDefault();
        event.stopPropagation();
        this._openExternalURL(link.url);
    },

    _onReaderKeyUp(doc, event) {
        if (!event) return;
        const map = { Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'meta' };
        if (!map[event.key]) return;
        this._updateModifierState(event);
        this.modifierState[map[event.key]] = false;
        // Database links should disappear immediately when Shift is released.
        // If the cursor is over an abbreviation, fall back to the plain
        // abbreviation tooltip; if it is over a lookup-only token, hide it.
        this._refreshHoverFromLastState(doc);
    },

    _onReaderBlur(doc) {
        this.modifierState = { shift: false, ctrl: false, alt: false, meta: false };
        this._refreshHoverFromLastState(doc);
    },

    _openExternalURL(url) {
        try {
            if (typeof Zotero !== 'undefined' && Zotero.launchURL) {
                Zotero.launchURL(url);
                return;
            }
        } catch (e) {}
        try {
            if (this.hoverPinnedDoc && this.hoverPinnedDoc.defaultView) {
                this.hoverPinnedDoc.defaultView.open(url, '_blank', 'noopener');
            }
        } catch (e) {}
    },

    _scheduleHoverHide(doc, delay) {
        this._cancelHoverHide();
        this.hoverHideTimer = setTimeout(() => {
            this.hoverHideTimer = null;
            this._hideHoverTooltip(doc);
        }, delay || 500);
    },

    _cancelHoverHide() {
        if (this.hoverHideTimer) {
            clearTimeout(this.hoverHideTimer);
            this.hoverHideTimer = null;
        }
    },

    /** Drop the tooltip element so appearance changes take effect next hover. */
    _resetHoverTooltips() {
        for (const rec of this.hoverDocs || []) {
            try {
                const tip = rec.doc.getElementById('abbreviation-helper-tooltip');
                if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
            } catch (e) {}
        }
    },

    _hideHoverTooltip(doc) {
        this._cancelHoverHide();
        this._clearCorridor();
        this.hoverPinnedDoc = null;
        this.hoverInteractiveTooltip = false;
        this.activeGeneLinks = [];
        this._renderedSig = null;
        this.hoverAnchor = null;
        try {
            const tip = doc.getElementById('abbreviation-helper-tooltip');
            if (tip) {
                tip.style.display = 'none';
                tip.style.pointerEvents = 'none';
                tip.dataset.abbreviationHelperInteractive = 'false';
            }
        } catch (e) {}
    }
};