#!/usr/bin/env bash
# Build the installable zips: one for Chrome, Brave, Edge and the other
# Chromium browsers, one for Firefox.
#
#   scripts/package.sh            → dist/jdsend-<version>-chrome.zip
#                                   dist/jdsend-<version>-firefox.zip
#
# The source tree is laid out for Chrome and loads unpacked as it is. Firefox
# runs the background as an event page rather than a service worker and wants
# an add-on id, so its manifest differs in those two places and nowhere else.
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(jq -r .version manifest.json)
rm -rf dist
mkdir -p dist

stage() {
    local dir=$1
    mkdir -p "$dir"
    cp -r background.js js css popup dialog options LICENSE "$dir/"
    mkdir -p "$dir/icons"
    cp icons/*.png "$dir/icons/"
}

stage dist/chrome
cp manifest.json dist/chrome/
(cd dist/chrome && zip -qr "../jdsend-${version}-chrome.zip" .)

stage dist/firefox
jq '.background = { "scripts": ["js/myjd.js", "background.js"] }
    | .browser_specific_settings = {
        "gecko": {
          "id": "jdsend@rylos.github.io",
          "strict_min_version": "128.0",
          "data_collection_permissions": { "required": ["none"] }
        }
      }' manifest.json > dist/firefox/manifest.json
(cd dist/firefox && zip -qr "../jdsend-${version}-firefox.zip" .)

ls -l dist/*.zip
