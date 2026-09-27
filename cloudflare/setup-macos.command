#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[X-Nekama] Node.js 24 or later is required."
  echo "https://nodejs.org/"
  echo
  exit 1
fi
exec node setup.mjs
