#!/usr/bin/env bash
# ==============================================================================
# Tinty Extension Packaging Script
# Bundles production extension files into a clean .zip ready for GitHub Releases
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/dist"
VERSION=$(grep '"version"' "${SCRIPT_DIR}/manifest.json" | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')
ZIP_NAME="tinty-v${VERSION}.zip"

echo "📦 Packaging Tinty v${VERSION}..."

mkdir -p "${DIST_DIR}"
rm -f "${DIST_DIR}/${ZIP_NAME}"

cd "${SCRIPT_DIR}"

zip -r -q "${DIST_DIR}/${ZIP_NAME}" \
  manifest.json \
  content.js \
  theme-parser.js \
  builtin-themes.js \
  popup.html \
  popup.css \
  popup.js \
  options.html \
  options.css \
  options.js \
  LICENSE

echo "✅ Created production release archive: dist/${ZIP_NAME}"
echo "📁 Size: $(du -h "${DIST_DIR}/${ZIP_NAME}" | cut -f1)"
