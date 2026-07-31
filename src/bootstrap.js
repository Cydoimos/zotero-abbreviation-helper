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

    // Listen for new main windows opening so the plugin can insert
    // its menu item automatically. Register this before the first UI
    // injection attempt so restart-time window creation is not missed.
    Services.wm.addListener(windowListener);

    // During normal manual installation, the main Zotero window is already
    // ready, so addToAllWindows() works immediately. During app startup,
    // however, Zotero can start the add-on before ZoteroPane and the Tools
    // menu exist. In that case a single addToAllWindows() call silently
    // finds no usable window and the add-on appears to “disappear” until it
    // is reinstalled. Retry for a short period so restart-time startup is
    // reliable without changing any detector behavior.
    addUIWhenReady().catch(e => log("Delayed UI registration failed: " + e));
}


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
    try {
        Services.wm.removeListener(windowListener);
    } catch (e) {}
    if (AbbreviationHelper) {
        AbbreviationHelper.removeFromAllWindows();
        AbbreviationHelper = undefined;
    }
}

// Window hooks for Zotero 7+. These are called when the main Zotero
// window is opened or closed. Without these hooks Zotero will log
// warnings about missing methods. We simply delegate to our existing
// functions to add or remove UI.

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

// Listener used to detect when new Zotero windows open.  When a new
// window opens we wait for it to finish loading before injecting our
// menu item.  Without this listener the menu item would only be added
// to windows that were open when the plugin loaded.
var windowListener = {
    onOpenWindow(xulWindow) {
        // Defer until the window's document is ready.  When using
        // nsIWindowMediator listeners you must query the interface this way.
        let window = xulWindow.docShell.domWindow;
        window.addEventListener("load", function () {
            if (window.ZoteroPane) {
                AbbreviationHelper.addToWindow(window);
            }
        }, { once: true });
    },
    onCloseWindow() {},
    onWindowTitleChange() {}
};