#!/bin/bash

# Determine version: prefer first argument, then manifest.json, then default.
if [ -n "${1-}" ]; then
    VERSION="$1"
elif [ -f manifest.json ]; then
    VERSION="$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
else
    VERSION="1.0.1"
fi

ZIP_NAME="wakosta_v${VERSION}.zip"

zip -r "$ZIP_NAME" . -x "*.git/*" "*.DS_Store" "*.zip"
