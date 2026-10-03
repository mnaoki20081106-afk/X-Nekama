#!/usr/bin/env python3
"""Reject missing/duplicate injections before publishing an IPA artifact."""
import struct
import sys
import zipfile
from pathlib import PurePosixPath
from verify_ipa import main as verify_source


def verify_injection(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entries')
        if any(n.startswith('/') or '..' in PurePosixPath(n).parts for n in names):
            raise ValueError('Unsafe ZIP entry')
        if archive.testzip() is not None:
            raise ValueError('Corrupt IPA archive')
        entry = 'Payload/Twitter.app/Frameworks/XNekama.dylib'
        dylib = archive.read(entry)
        if len(dylib) < 32 or struct.unpack_from('<II', dylib) != (0xFEEDFACF, 0x100000C):
            raise ValueError('Expected an arm64 XNekama dylib')
        binary = archive.read('Payload/Twitter.app/Twitter')
        if len(binary) < 32 or struct.unpack_from('<II', binary) != (0xFEEDFACF, 0x100000C):
            raise ValueError('Expected arm64 app executable')
        offset = 32
        injected = []
        for _ in range(struct.unpack_from('<I', binary, 16)[0]):
            if offset + 8 > len(binary):
                raise ValueError('Truncated load command')
            command, size = struct.unpack_from('<II', binary, offset)
            if size < 8 or offset + size > len(binary):
                raise ValueError('Invalid load command size')
            if command in (12, 0x80000018):
                if size < 24:
                    raise ValueError('Invalid dylib load command')
                start = struct.unpack_from('<I', binary, offset + 8)[0]
                if not 24 <= start < size:
                    raise ValueError('Invalid dylib load path')
                name = binary[offset + start:offset + size].split(b'\0')[0]
                if name.endswith(b'/XNekama.dylib'):
                    injected.append(name)
            offset += size
        if injected not in ([b'@rpath/XNekama.dylib'], [b'@executable_path/Frameworks/XNekama.dylib']):
            raise ValueError('Expected one resolvable XNekama load command')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: verify_built_ipa.py path/to/built.ipa')
    verify_source(sys.argv[1])
    verify_injection(sys.argv[1])
    print('[x-nekama] Complete IPA archive and injection check passed')
