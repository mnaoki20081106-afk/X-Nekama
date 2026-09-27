#!/usr/bin/env python3
import plistlib
import struct
import sys
import zipfile

EXPECTED_BUNDLE_ID = "com.atebits.Tweetie2"
EXPECTED_VERSION = "12.29"
EXPECTED_BUILD = "20"
LC_ENCRYPTION_INFO_64 = 0x2C
MH_MAGIC_64 = 0xFEEDFACF

def die(message):
    print(f"[x-nekama] {message}", file=sys.stderr)
    raise SystemExit(1)

def encryption_cryptid(binary):
    if len(binary) < 32:
        die("Twitter executable is too small")
    magic, = struct.unpack_from("<I", binary, 0)
    if magic != MH_MAGIC_64:
        die(f"unsupported Mach-O magic: 0x{magic:08x}")
    _, _, _, _, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", binary, 0)
    offset = 32
    for _ in range(ncmds):
        if offset + 8 > len(binary):
            die("truncated Mach-O load commands")
        cmd, cmdsize = struct.unpack_from("<II", binary, offset)
        if cmdsize < 8 or offset + cmdsize > len(binary):
            die("invalid Mach-O load command")
        if cmd == LC_ENCRYPTION_INFO_64:
            _, _, _, _, cryptid, _ = struct.unpack_from("<IIIIII", binary, offset)
            return cryptid
        offset += cmdsize
    return None

def main(path):
    with zipfile.ZipFile(path, "r") as zf:
        info_path = "Payload/Twitter.app/Info.plist"
        exe_path = "Payload/Twitter.app/Twitter"
        try:
            info = plistlib.loads(zf.read(info_path))
            executable = zf.read(exe_path)
        except KeyError as exc:
            die(f"missing required IPA entry: {exc}")

    bundle_id = info.get("CFBundleIdentifier")
    version = info.get("CFBundleShortVersionString")
    build = info.get("CFBundleVersion")
    cryptid = encryption_cryptid(executable)

    print(f"bundle={bundle_id}")
    print(f"version={version}")
    print(f"build={build}")
    print(f"cryptid={cryptid}")

    if bundle_id != EXPECTED_BUNDLE_ID:
        die(f"expected {EXPECTED_BUNDLE_ID}, got {bundle_id}")
    if version != EXPECTED_VERSION or build != EXPECTED_BUILD:
        die(
            f"this tweak is verified for X {EXPECTED_VERSION} ({EXPECTED_BUILD}); "
            f"got {version} ({build})"
        )
    if cryptid not in (0, None):
        die("IPA is encrypted; provide a decrypted IPA")
    print("[x-nekama] IPA compatibility check passed")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        die("usage: verify_ipa.py path/to/X.ipa")
    main(sys.argv[1])
