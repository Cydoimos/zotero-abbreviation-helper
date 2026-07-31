#!/usr/bin/env bash
#
# Reproducible build for the Abbreviation Helper .xpi.
#
#   ./build.sh            build using the version in manifest.json
#   ./build.sh --check    build, then run the full test suite against it
#
# Two things this script exists to get right, both of which have broken
# installs before:
#
#   1. `update_url` must be present in manifest.json. Without it Zotero refuses
#      to install the plugin and reports "may be incompatible with this version
#      of Zotero", which points at the version fields and wastes your time.
#   2. Files must sit at the archive root — manifest.json at the top level, not
#      inside a directory.
#
set -euo pipefail
cd "$(dirname "$0")"

SRC="src"
FILES=(manifest.json install.rdf bootstrap.js abbreviation.js
       icon32.png icon48.png icon96.png data/abbreviations.json)

VERSION=$(node -p "require('./$SRC/manifest.json').version")
OUT="abbreviation-helper-${VERSION}.xpi"

# ---- preflight -------------------------------------------------------------
node -e "
const m = require('./$SRC/manifest.json');
const z = m.applications && m.applications.zotero;
if (!z)            { console.error('FAIL: applications.zotero missing'); process.exit(1); }
if (!z.update_url) { console.error('FAIL: update_url missing - Zotero will refuse to install'); process.exit(1); }
if (!z.id)         { console.error('FAIL: id missing'); process.exit(1); }
if (!z.strict_max_version || z.strict_max_version === '*') {
  console.error('WARN: strict_max_version should name a tested version, e.g. 9.*');
}
console.log('manifest OK  ' + z.id + '  ' + m.version + '  Zotero ' + z.strict_min_version + '-' + z.strict_max_version);
"
node --check "$SRC/abbreviation.js"
node --check "$SRC/bootstrap.js"
node -e "JSON.parse(require('fs').readFileSync('$SRC/data/abbreviations.json','utf8'))"
python3 -c "import xml.dom.minidom; xml.dom.minidom.parse('$SRC/install.rdf')"

for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "FAIL: missing $SRC/$f"; exit 1; }
done

# ---- package ---------------------------------------------------------------
# Build to a temporary file and move into place, so a partially written
# archive is never left behind (and so this works on mounted filesystems
# that disallow in-place zip replacement).
TMP=$(mktemp -d)
mkdir -p "$TMP/pkg"
trap 'rm -rf "$TMP"' EXIT
# Normalise timestamps so identical content always produces an identical
# archive — otherwise the SHA-256 in update.json changes on every rebuild.
cp -r "$SRC"/. "$TMP/pkg"
find "$TMP/pkg" -exec touch -t 202001010000.00 {} +
( cd "$TMP/pkg" && zip -X -9 -q "$TMP/out.xpi" "${FILES[@]}" )
unzip -tq "$TMP/out.xpi" >/dev/null
cp -f "$TMP/out.xpi" "$OUT"

HASH=$(sha256sum "$OUT" | cut -d' ' -f1)
echo "built $OUT  ($(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") bytes)"
echo "sha256 $HASH"
echo
echo "Put this in update.json:"
echo "  \"update_hash\": \"sha256:$HASH\""

# ---- optional verification --------------------------------------------------
if [ "${1:-}" = "--check" ]; then
  echo
  for t in test-runaway test-peptides test-prefs test-hover test-userdict test-features test-menu; do
    printf '  %-16s ' "$t"
    node "test/$t.js" >/dev/null 2>&1 && echo PASS || { echo FAIL; exit 1; }
  done
  node eval/score.js | tail -8
fi
