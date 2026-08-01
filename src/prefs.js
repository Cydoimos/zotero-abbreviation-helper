// Default preferences.
//
// Zotero reads this file — prefs.js in the plugin root — when the plugin is
// installed or enabled, and again at every startup. It must contain nothing
// but pref() calls.
//
// Without defaults here, a setting the user has never changed has no stored
// value, so a control in the Settings window bound to it renders blank. The
// values below mirror the defaults in abbreviation.js and must be kept in
// step with them; test/test-settings.js checks that they agree.

pref("extensions.abbreviation-helper.hoverEnabled", true);
pref("extensions.abbreviation-helper.tooltipModifier", "none");
pref("extensions.abbreviation-helper.databaseLinksEnabled", true);
pref("extensions.abbreviation-helper.databaseLinksModifier", "shift");
pref("extensions.abbreviation-helper.databaseLinksOnAbbreviations", true);
pref("extensions.abbreviation-helper.tooltipFontSize", 12);
pref("extensions.abbreviation-helper.tooltipTheme", "dark");
pref("extensions.abbreviation-helper.disabledDatabases", "");
pref("extensions.abbreviation-helper.enabledDatabases", "");
pref("extensions.abbreviation-helper.advancedMenu", false);
