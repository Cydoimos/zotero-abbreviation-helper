/*
 * Entry point for the Abbreviation Helper plugin.  This file defines the
 * lifecycle hooks required by Zotero (install, uninstall, startup,
 * shutdown).  On startup it loads the main implementation from
 * abbreviation.js and registers UI elements.  On shutdown it cleans up
 * any UI it added to Zotero windows.  See abbreviation.js for the
 * implementation details.
 */

var AbbreviationHelper;

function log(msg) {
    // Prefix log messages so they can be filtered in the Zotero debug console.
    Zotero.debug("Abbreviation Helper: " + msg);
}

function install() {
    log("Installed");
}

function uninstall() {
    log("Uninstalled");
}

/**
 * Called when the plugin is enabled in Zotero.  Loads the main script
 * and registers menu items for all open Zotero windows.  The rootURI
 * parameter points to the directory containing this bootstrap file and
 * other plugin resources.
 */
async function startup({ id, version, rootURI }) {
    log("Starting");
    // Load the main plugin implementation.  Use Services.scriptloader to
    // evaluate abbreviation.js in this global scope.  This makes the
    // AbbreviationHelper object available.
    Services.scriptloader.loadSubScript(rootURI + "abbreviation.js");
    if (!AbbreviationHelper) {
        log("Main script failed to load");
        return;
    }
    AbbreviationHelper.init({ id, version, rootURI });

    // Settings live in Zotero's Settings window. This is the only place they
    // can all be changed without the menu closing after each one — on macOS
    // the Tools menu is a native NSMenu and always dismisses on selection.
    AbbreviationHelper.registerPreferencePane();

    // Main windows opened later get the menu through onMainWindowLoad below,
    // which Zotero calls for every one of them.
    //
    // During normal manual installation, the main Zotero window is already
    // ready, so addToAllWindows() works immediately. During app startup,
    // however, Zotero can start the add-on before ZoteroPane and the Tools
    // menu exist. In that case a single addToAllWindows() call silently
    // finds no usable window and the add-on appears to “disappear” until it
    // is reinstalled. Retry for a short period so restart-time startup is
    // reliable without changing any detector behavior.
    addUIWhenReady().catch(e => log("Delayed UI registration failed: " + e));
}

/** Add the menu once a main window with a Tools menu exists (up to 20 s). */
async function addUIWhenReady() {
    for (let attempt = 0; attempt < 40; attempt++) {
        if (!AbbreviationHelper) return;
        try {
            AbbreviationHelper.addToAllWindows();
            const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [];
            for (let win of wins) {
                if (!win || !win.document) continue;
                if (win.document.getElementById('abbreviation-helper-menu')) {
                    log("UI registered");
                    return;
                }
            }
        } catch (e) {
            log("UI registration attempt failed: " + e);
        }
        if (Zotero.Promise && Zotero.Promise.delay) {
            await Zotero.Promise.delay(500);
        } else {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    log("UI was not registered after waiting for Zotero windows");
}

/**
 * Called when the plugin is disabled or Zotero is shutting down.  Removes
 * UI and unloads the main implementation.
 */
function shutdown() {
    log("Shutting down");
    if (AbbreviationHelper) {
        // First, so a scan still waiting on Zotero's PDF worker cannot attach
        // listeners after everything below has been removed.
        if (typeof AbbreviationHelper.stop === 'function') AbbreviationHelper.stop();
        AbbreviationHelper.unregisterPreferencePane();
        AbbreviationHelper._unwatchPrefs();
        AbbreviationHelper.removeFromAllWindows();
        try { delete Zotero.AbbreviationHelper; } catch (e) {}
        AbbreviationHelper = undefined;
    }
}

// Window hooks, called by Zotero 7+ for every main window opened or closed
// after startup (it watches the windows itself and calls these).

function onMainWindowLoad({ window }) {
    try {
        if (AbbreviationHelper && window) {
            // Add the menu item to the newly opened window.  AbbreviationHelper
            // will perform its own checks to ensure the Tools menu exists.
            AbbreviationHelper.addToWindow(window);
        }
    } catch (e) {
        log('onMainWindowLoad error: ' + e);
    }
}

function onMainWindowUnload({ window }) {
    try {
        if (AbbreviationHelper && window) {
            // Remove the menu item from the closing window.
            AbbreviationHelper.removeFromWindow(window);
        }
    } catch (e) {
        log('onMainWindowUnload error: ' + e);
    }
}
