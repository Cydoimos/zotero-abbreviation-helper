'use strict';
/*
 * Script for the Abbreviation Helper pane in Zotero's Settings window.
 *
 * Most controls in settings.xhtml bind straight to a preference and need no
 * code. This file supplies the parts that cannot be static markup:
 *
 *   - the "Show:" lists: modifier keys, named for the platform (Command,
 *     Option on macOS), and a warning when two tooltips share one
 *   - forgetting the definitions learned from other papers
 *   - greying out controls whose checkbox is off
 *   - your own abbreviations, editable in place
 *   - the ignore list, editable in place
 *   - the database list, which comes from the abbreviations file
 *
 * All of these live in the abbreviations JSON file rather than in
 * preferences, so they cannot be expressed as `preference="..."` bindings.
 *
 * Nothing here may throw: a broken pane would make Zotero's whole Settings
 * window unusable, which is far worse than a missing control.
 */
var AbbrevSettings = {
    ROOT_ID: 'abbrev-settings-root',
    _initialised: false,

    /** The running plugin, published on the Zotero object by abbreviation.js. */
    get helper() {
        try { return Zotero.AbbreviationHelper || null; } catch (e) { return null; }
    },

    init() {
        if (this._initialised) return true;
        if (typeof document === 'undefined') return false;
        const root = document.getElementById(this.ROOT_ID);
        if (!root) return false;            // markup not inserted yet
        this._initialised = true;
        this.doc = document;
        try {
            this._fillModifierMenus();
            this._wireButtons();
            this.refresh();
        } catch (e) {
            this._log('Settings pane failed to initialise: ' + e);
        }
        return true;
    },

    /** Rebuild everything driven by the abbreviations file. */
    refresh() {
        this._showFileStatus();
        this._showLibraryCount();
        this._buildDefinitionList();
        this._buildIgnoreList();
        this._buildDatabaseList();
        this._syncDependents();
        this._showKeyClash();
    },

    /* ---- definitions learned from other papers --------------------------- */
    _showLibraryCount() {
        const H = this.helper;
        const n = (H && H._libraryPaperCount) ? H._libraryPaperCount() : 0;
        const el = this._byId('abbrev-settings-library-count');
        if (el) el.textContent = n ? 'Learned from ' + n + (n === 1 ? ' paper' : ' papers') + ' so far.' : 'Nothing learned yet.';
        this._setDisabled('abbrev-settings-library-forget', !n);
    },

    _forgetLibrary() {
        const H = this.helper;
        if (!H || !H._forgetLibrary) return;
        const n = H._libraryPaperCount ? H._libraryPaperCount() : 0;
        const question = 'Forget the definitions learned from ' + n + (n === 1 ? ' paper' : ' papers')
            + '? Papers you open from now on are learned from again while the setting is on.';
        let ok = false;
        try { ok = Services.prompt.confirm(this.doc.defaultView, 'Abbreviation Helper', question); }
        catch (e) { this._log('No confirmation dialog: ' + e); }
        if (!ok) return;
        Promise.resolve(H._forgetLibrary())
            .then(() => this._showLibraryCount())
            .catch(e => this._log('Could not forget the learned definitions: ' + e));
    },

    /**
     * Say so when the abbreviations file cannot be read. The plugin then
     * leaves the file alone, so your entries are not in use until it is fixed.
     */
    _showFileStatus() {
        const H = this.helper;
        const problem = H && H.userFileError;
        this._error('abbrev-settings-file-error', problem
            ? 'Your abbreviations file could not be read, so your own entries are not in use. '
                + problem + ' Open it with "Open abbreviations file…" below, correct it, '
                + 'then press "Reload from file". The plugin will not change the file until then.'
            : '');
    },

    /** Why a change was not saved, in the plugin's words when it has them. */
    _saveError(id, e, what) {
        this._log('Could not ' + what + ': ' + e);
        const H = this.helper;
        this._error(id, (H && H._saveFailedMessage) ? H._saveFailedMessage() : 'Could not save that entry.');
        this._showFileStatus();
    },

    _log(msg) {
        try { Zotero.debug('Abbreviation Helper: ' + msg); } catch (e) {}
    },

    _byId(id) { return this.doc.getElementById(id); },

    _html(tag) {
        return this.doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    },

    /* ---- what shows each tooltip ------------------------------------------ */
    /**
     * The "Show:" list of each tooltip, built here because its entries come
     * from the plugin: the modifier keys, named for the platform. Where a
     * word is used has no "Always": shown for every word, it would hide
     * every meaning.
     */
    _fillModifierMenus() {
        const H = this.helper;
        const modifiers = (H && H._modifierChoices) ? H._modifierChoices() : [
            { id: 'none', label: 'Always' },
            { id: 'shift', label: 'Only while holding Shift' },
            { id: 'ctrl', label: 'Only while holding Ctrl' },
            { id: 'alt', label: 'Only while holding Alt' }
        ];
        this._fillMenu('abbrev-settings-tooltip-modifier', modifiers);
        this._fillMenu('abbrev-settings-db-modifier', modifiers);
        this._fillMenu('abbrev-settings-uses-modifier', modifiers.filter(c => c.id !== 'none'));
    },

    /**
     * Say so when the key of "where a word is used" also shows another
     * tooltip: while it is held, the uses are shown instead.
     */
    _showKeyClash() {
        const value = id => { const el = this._byId(id); return el ? String(el.value || '') : ''; };
        const uses = value('abbrev-settings-uses-modifier');
        const others = [];
        if (this._isTicked('abbrev-settings-hover') && value('abbrev-settings-tooltip-modifier') === uses) others.push('meanings');
        if (this._isTicked('abbrev-settings-db-enabled') && value('abbrev-settings-db-modifier') === uses) others.push('database links');
        this._error('abbrev-settings-uses-clash', this._isTicked('abbrev-settings-uses') && others.length
            ? 'The same key shows ' + others.join(' and ') + ': while you hold it, the uses are shown instead.'
            : '');
    },

    _isTicked(id) {
        const el = this._byId(id);
        if (!el) return false;
        return (typeof el.checked === 'boolean') ? el.checked : el.getAttribute('checked') === 'true';
    },

    _fillMenu(id, choices) {
        const list = this._byId(id);
        const popup = list && list.querySelector('menupopup');
        if (!popup) return;
        while (popup.firstChild) popup.removeChild(popup.firstChild);
        for (const choice of choices) {
            const item = this.doc.createXULElement('menuitem');
            item.setAttribute('value', choice.id);
            item.setAttribute('label', choice.label);
            popup.appendChild(item);
        }
        // The preference binding ran before these items existed, so the
        // menulist has a value but nothing to show for it. Re-apply.
        const pref = list.getAttribute('preference');
        if (!pref) return;
        let current = null;
        try { current = Zotero.Prefs.get(pref, true); } catch (e) {}
        if (current === undefined || current === null) current = choices[0].id;
        list.value = String(current);
    },

    /* ---- your abbreviations ---------------------------------------------- */
    _buildDefinitionList() {
        const body = this._byId('abbrev-settings-def-list');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        const H = this.helper;
        const defs = (H && H._userDefinitions) ? H._userDefinitions() : {};
        const names = Object.keys(defs).sort();
        if (!names.length) {
            body.appendChild(this._emptyRow(3, 'You have not defined any abbreviations yet.'));
            return;
        }
        for (const abbr of names) {
            const tr = this._html('tr');
            tr.appendChild(this._cell(abbr, 'abbrev-settings-short'));
            tr.appendChild(this._cell(defs[abbr]));
            tr.appendChild(this._actionCell('Remove', () => {
                Promise.resolve(H._removeUserDefinition(abbr))
                    .then(() => {
                        this._error('abbrev-settings-def-error', '');
                        this._buildDefinitionList();
                    })
                    .catch(e => this._saveError('abbrev-settings-def-error', e, 'remove ' + abbr));
            }));
            body.appendChild(tr);
        }
    },

    _addDefinition() {
        const H = this.helper;
        const abbrEl = this._byId('abbrev-settings-def-abbr');
        const termEl = this._byId('abbrev-settings-def-term');
        if (!H || !abbrEl || !termEl) return;

        const abbr = String(abbrEl.value || '').trim();
        const term = String(termEl.value || '').trim();
        if (!abbr || !term) {
            this._error('abbrev-settings-def-error',
                'Enter both a short form and what it means.');
            return;
        }
        this._error('abbrev-settings-def-error', '');
        Promise.resolve(H._setUserDefinition(abbr, term))
            .then(() => {
                abbrEl.value = '';
                termEl.value = '';
                this._buildDefinitionList();
            })
            .catch(e => this._saveError('abbrev-settings-def-error', e, 'add ' + abbr));
    },

    /* ---- ignore list ----------------------------------------------------- */
    _buildIgnoreList() {
        const body = this._byId('abbrev-settings-ignore-list');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        const H = this.helper;
        const list = (H && H._ignoreList) ? H._ignoreList() : [];
        this._setDisabled('abbrev-settings-ignore-clear', !list.length);
        if (!list.length) {
            body.appendChild(this._emptyRow(2, 'Nothing is being ignored.'));
            return;
        }
        for (const abbr of list.slice().sort()) {
            const tr = this._html('tr');
            tr.appendChild(this._cell(abbr, 'abbrev-settings-short'));
            tr.appendChild(this._actionCell('Remove', () => {
                Promise.resolve(H._stopIgnoring(abbr))
                    .then(() => {
                        this._error('abbrev-settings-ignore-error', '');
                        this._buildIgnoreList();
                    })
                    .catch(e => this._saveError('abbrev-settings-ignore-error', e, 'un-ignore ' + abbr));
            }));
            body.appendChild(tr);
        }
    },

    _addIgnore() {
        const H = this.helper;
        const input = this._byId('abbrev-settings-ignore-input');
        if (!H || !input) return;
        const abbr = String(input.value || '').trim();
        if (!abbr) {
            this._error('abbrev-settings-ignore-error', 'Enter a short form to ignore.');
            return;
        }
        this._error('abbrev-settings-ignore-error', '');
        Promise.resolve(H._ignoreAbbreviation(abbr))
            .then(() => { input.value = ''; this._buildIgnoreList(); })
            .catch(e => this._saveError('abbrev-settings-ignore-error', e, 'ignore ' + abbr));
    },

    /* ---- databases ------------------------------------------------------- */
    _buildDatabaseList() {
        const body = this._byId('abbrev-settings-db-list');
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);

        const H = this.helper;
        const all = (H && H.dictionaries && H.dictionaries.databases) || [];
        if (!all.length) {
            body.appendChild(this._emptyRow(2, 'No databases configured.'));
            return;
        }
        const groups = (H && H._databaseGroups) ? H._databaseGroups() : ['Databases'];
        for (const groupLabel of groups) {
            const inGroup = all.filter(d => (d.group || 'Databases') === groupLabel);
            if (!inGroup.length) continue;

            const head = this._html('tr');
            head.classList.add('abbrev-settings-group-row');
            const headCell = this._html('td');
            headCell.setAttribute('colspan', '2');
            headCell.textContent = groupLabel;
            head.appendChild(headCell);
            body.appendChild(head);

            for (const db of inGroup) {
                const tr = this._html('tr');

                const boxCell = this._html('td');
                // A XUL checkbox, not an HTML one, so it matches the other
                // checkboxes in the pane and follows Zotero's theme.
                const cb = this.doc.createXULElement('checkbox');
                cb.setAttribute('native', 'true');
                cb.checked = H._isDatabaseOn(db);
                cb.setAttribute('checked', cb.checked ? 'true' : 'false');
                cb.addEventListener('command', () => {
                    // The live property is authoritative; the attribute is only
                    // what the pane was built with and may be stale.
                    const nowOn = (typeof cb.checked === 'boolean')
                        ? cb.checked
                        : cb.getAttribute('checked') === 'true';
                    try { H._setDatabaseEnabled(db.label, nowOn); }
                    catch (e) { this._log('Could not toggle ' + db.label + ': ' + e); }
                });
                boxCell.appendChild(cb);
                tr.appendChild(boxCell);

                tr.appendChild(this._cell(db.label));
                body.appendChild(tr);
            }
        }
    },

    /* ---- table helpers --------------------------------------------------- */
    _cell(text, className) {
        const td = this._html('td');
        td.textContent = text;
        if (className) td.classList.add(className);
        return td;
    },

    _actionCell(label, onClick) {
        const td = this._html('td');
        const button = this._html('button');
        button.textContent = label;
        button.addEventListener('click', onClick);
        td.appendChild(button);
        return td;
    },

    _emptyRow(columns, text) {
        const tr = this._html('tr');
        tr.classList.add('abbrev-settings-empty');
        const td = this._html('td');
        td.setAttribute('colspan', String(columns));
        td.textContent = text;
        tr.appendChild(td);
        return tr;
    },

    /* ---- buttons --------------------------------------------------------- */
    _wireButtons() {
        const H = this.helper;
        const win = this.doc.defaultView;

        this._onClick('abbrev-settings-def-add', () => this._addDefinition());
        this._onEnter('abbrev-settings-def-abbr', () => this._addDefinition());
        this._onEnter('abbrev-settings-def-term', () => this._addDefinition());

        this._onClick('abbrev-settings-ignore-add', () => this._addIgnore());
        this._onEnter('abbrev-settings-ignore-input', () => this._addIgnore());

        this._onClick('abbrev-settings-ignore-clear', () => {
            if (!H) return;
            Promise.resolve(H._setIgnoreList([]))
                .then(() => {
                    this._error('abbrev-settings-ignore-error', '');
                    this._buildIgnoreList();
                })
                .catch(e => this._saveError('abbrev-settings-ignore-error', e, 'clear the ignore list'));
        });

        this._onClick('abbrev-settings-library-forget', () => this._forgetLibrary());

        for (const [masterId] of this.DEPENDENTS) {
            const master = this._byId(masterId);
            if (master) master.addEventListener('command', () => { this._syncDependents(); this._showKeyClash(); });
        }
        for (const id of ['abbrev-settings-tooltip-modifier', 'abbrev-settings-db-modifier', 'abbrev-settings-uses-modifier']) {
            const list = this._byId(id);
            if (list) list.addEventListener('command', () => this._showKeyClash());
        }

        this._onClick('abbrev-settings-db-edit', () => this._openFile());
        this._onClick('abbrev-settings-open-file', () => this._openFile());

        this._onClick('abbrev-settings-reload-file', () => {
            if (!H) return;
            Promise.resolve(H._reloadDictionaries(win))
                .then(() => this.refresh())
                .catch(e => this._log('Reload failed: ' + e));
        });
    },

    _openFile() {
        const H = this.helper;
        if (!H) return;
        Promise.resolve(H._openUserDictionary(this.doc.defaultView))
            .catch(e => this._log('Could not open the abbreviations file: ' + e));
    },

    _onClick(id, fn) {
        const el = this._byId(id);
        if (el) el.addEventListener('click', fn);
    },

    /* Enter in a text field should do the obvious thing. */
    _onEnter(id, fn) {
        const el = this._byId(id);
        if (!el) return;
        el.addEventListener('keypress', (event) => {
            if (event && (event.key === 'Enter' || event.keyCode === 13)) {
                if (event.preventDefault) event.preventDefault();
                fn();
            }
        });
    },

    _setDisabled(id, state) {
        const el = this._byId(id);
        if (el) el.disabled = !!state;
    },

    _error(id, text) {
        const el = this._byId(id);
        if (!el) return;
        el.textContent = text || '';
        el.setAttribute('hidden', text ? 'false' : 'true');
    },

    // Each tooltip's switch, with its "Show:" choice on the same line and
    // the options indented under it: they only apply while it is ticked.
    DEPENDENTS: [
        ['abbrev-settings-hover', ['abbrev-settings-hover-show', 'abbrev-settings-hover-dependent']],
        ['abbrev-settings-db-enabled', ['abbrev-settings-db-show', 'abbrev-settings-db-dependent']],
        ['abbrev-settings-uses', ['abbrev-settings-uses-show', 'abbrev-settings-uses-dependent']]
    ],

    /**
     * Grey out the controls that only apply while their tooltip is switched
     * on, so no visible control silently does nothing.
     */
    _syncDependents() {
        for (const [masterId, dependentIds] of this.DEPENDENTS) {
            if (!this._byId(masterId)) continue;
            const on = this._isTicked(masterId);
            for (const id of dependentIds) {
                const dependent = this._byId(id);
                if (!dependent) continue;
                dependent.setAttribute('disabled', on ? 'false' : 'true');
                dependent.style.opacity = on ? '' : '0.5';
            }
        }
    }
};

/*
 * Start without depending on the root element's `onload`. Zotero may run this
 * script before or after inserting the markup, and an inline handler that
 * never fires is exactly what left every control dead in 1.5.0. init() is
 * idempotent, so the onload attribute and this loop cannot collide.
 */
(function startAbbrevSettings() {
    try {
        if (AbbrevSettings.init()) return;
        let tries = 0;
        const timer = setInterval(() => {
            if (AbbrevSettings.init() || ++tries > 60) clearInterval(timer);
        }, 50);
    } catch (e) {
        try { Zotero.debug('Abbreviation Helper: settings pane could not start: ' + e); } catch (e2) {}
    }
})();
