#!/bin/bash
set -euo pipefail

MODE="${1:---sideloaded}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
IPA="${IPA_PATH:-$ROOT/packages/com.atebits.Tweetie2.ipa}"

cd "$ROOT"
python3 ./verify_ipa.py "$IPA"

case "$MODE" in
  --sideloaded|--sidestore|--trollstore)
    make clean
    rm -rf .theos
    make

    DYLIB="$(find .theos/obj -type f -name XNekama.dylib | head -n1)"
    if [[ -z "$DYLIB" || ! -f "$DYLIB" ]]; then
      echo "XNekama.dylib was not produced" >&2
      exit 1
    fi

    if ! command -v cyan >/dev/null 2>&1; then
      echo "cyan is required for IPA injection (install pyzule-rw)." >&2
      exit 1
    fi

    if [[ "$MODE" == "--trollstore" ]]; then
      OUT="$ROOT/packages/X-Nekama-X12.29.tipa"
    else
      OUT="$ROOT/packages/X-Nekama-X12.29.ipa"
    fi

    if [[ "$MODE" == "--sidestore" ]]; then
      if python3 - "$IPA" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    sys.exit(0 if 'Payload/Twitter.app/Frameworks/XNekama.dylib' in archive.namelist() else 1)
PY
      then
        REPACKED="$(mktemp -d)/X-replaced.ipa"
        python3 ./replace_injected_tweak.py "$IPA" "$DYLIB" "$REPACKED"
        cyan -i "$REPACKED" -o "$OUT" -n "X-Nekama" -u -w -e
        rm -f "$REPACKED"
        rmdir "$(dirname "$REPACKED")"
      else
        cyan -i "$IPA" -o "$OUT" -n "X-Nekama" -u -w -e -f "$DYLIB"
      fi
    else
      cyan -i "$IPA" -o "$OUT" -u -w -f "$DYLIB"
    fi
    python3 ./verify_built_ipa.py "$OUT"
    echo "Created: $OUT"
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
    echo "Usage: $0 [--sidestore|--sideloaded|--trollstore|--rootless|--rootfull]" >&2
    exit 2
    ;;
esac
