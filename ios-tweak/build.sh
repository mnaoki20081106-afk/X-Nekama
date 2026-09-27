#!/bin/bash
set -euo pipefail

MODE="${1:---sideloaded}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
IPA="$ROOT/packages/com.atebits.Tweetie2.ipa"
OUT="$ROOT/packages/X-Nekama"

cd "$ROOT"

case "$MODE" in
  --sideloaded)
    make clean
    rm -rf .theos
    make

    if [[ ! -f "$IPA" ]]; then
      echo "Missing decrypted IPA: $IPA" >&2
      exit 1
    fi

    if ! command -v cyan >/dev/null 2>&1; then
      echo "cyan is required for sideloaded IPA injection." >&2
      exit 1
    fi

    cyan -i "$IPA" -o "$OUT-sideloaded" --ignore-encrypted \
      -uwf .theos/obj/debug/XNekama.dylib

    echo "Created: $OUT-sideloaded.ipa"
    ;;
  --rootless)
    make clean
    rm -rf .theos
    export THEOS_PACKAGE_SCHEME=rootless
    make package
    ;;
  --rootfull)
    make clean
    rm -rf .theos
    unset THEOS_PACKAGE_SCHEME || true
    make package
    ;;
  *)
    echo "Usage: $0 [--sideloaded|--rootless|--rootfull]" >&2
    exit 2
    ;;
esac
