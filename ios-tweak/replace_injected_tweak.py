#!/usr/bin/env python3
"""Replace a previously verified injection without adding a second load command."""
import shutil
import copy
import sys
import zipfile
from verify_built_ipa import verify_injection

ENTRY = 'Payload/Twitter.app/Frameworks/XNekama.dylib'


def replace(source, dylib, target):
    verify_injection(source)
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, 'w') as dst:
        for entry in src.infolist():
            # ZipFile mutates header_offset when writing; keep source metadata intact.
            with dst.open(copy.copy(entry), 'w') as output:
                if entry.filename == ENTRY:
                    with open(dylib, 'rb') as replacement:
                        shutil.copyfileobj(replacement, output)
                else:
                    with src.open(entry) as original:
                        shutil.copyfileobj(original, output)
    verify_injection(target)


if __name__ == '__main__':
    replace(*sys.argv[1:])
