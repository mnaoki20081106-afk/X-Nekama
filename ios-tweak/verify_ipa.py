#!/usr/bin/env python3
import plistlib
import struct
import sys
import zipfile

EXPECTED_BUNDLE_ID = "com.atebits.Tweetie2"
EXPECTED_VERSION = "12.29"
EXPECTED_BUILD = "20"
LC_SEGMENT_64 = 0x19
LC_ENCRYPTION_INFO_64 = 0x2C
MH_MAGIC_64 = 0xFEEDFACF
PTR_MASK = (1 << 36) - 1

REQUIRED_METHODS = {
    "Payload/Twitter.app/Frameworks/T1Twitter.framework/T1Twitter": {
        "T1GrokTextPostComposerController": {
            "initWithAccount:initialText:onAcceptRevision:": "@40@0:8@16@24@?32",
        },
        "T1TweetComposeViewController": {
            "initWithAccount:compositions:inWindowScene:": "@36@0:8@16@24B32",
            "_t1_didTapSendButton:": "v24@0:8@16",
            "account": "@16@0:8",
            "activeComposition": "@16@0:8",
            "t1_activeTweetViewController": "@16@0:8",
            "_t1_openGrokImagineViewControllerWithInitialPrompt:": "v24@0:8@16",
            "_t1_syncAIDisclosureForComposition:": "v24@0:8@16",
            "setGrokImagineLightboxManager:": "v24@0:8@16",
            "grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:": "v40@0:8@16@24@32",
        },
        "T1UnifiedNotificationsSettingsViewController": {
            "initWithAccount:": "@24@0:8@16",
            "account": "@16@0:8",
        },
        "T1TweetComposeSingleTweetViewController": {
            "reloadCompositionText": "v16@0:8",
            "addOrReplaceAttachment:animated:": "v28@0:8@16B24",
        },
    },
    "Payload/Twitter.app/Frameworks/XAppLibraries.framework/XAppLibraries": {
        "TFNTwitterAccount": {
            "accountID": "@16@0:8",
            "username": "@16@0:8",
            "authenticatedMutableURLRequestForURLRequest:parameters:error:": "@40@0:8@16@24^@32",
        },
        "TFNTwitterComposition": {
            "initWithInitialText:mentionedUsers:": "@32@0:8@16@24",
            "text": "@16@0:8",
            "setText:": "v24@0:8@16",
            "addAttachment:": "v24@0:8@16",
        },
        "_TtC4Grok38GrokImagineLightboxPresentationManager": {
            "presentWithSourceImages:sourceType:from:sourceView:id:animated:": "v60@0:8@16q24@32@40@48B56",
        },
    },
}


def die(message):
    print(f"[x-nekama] {message}", file=sys.stderr)
    raise SystemExit(1)


def read_u32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


def read_u64(data, offset):
    return struct.unpack_from("<Q", data, offset)[0]


def read_cstring(data, offset, limit=2048):
    if not offset or offset < 0 or offset >= len(data):
        return None
    end = data.find(b"\0", offset, min(len(data), offset + limit))
    if end < 0:
        return None
    return data[offset:end].decode("utf-8", "replace")


def parse_sections(binary):
    if len(binary) < 32 or read_u32(binary, 0) != MH_MAGIC_64:
        die("unsupported Mach-O; expected 64-bit arm64")
    header = struct.unpack_from("<IiiIIIII", binary, 0)
    ncmds = header[4]
    offset = 32
    sections = {}
    for _ in range(ncmds):
        if offset + 8 > len(binary):
            die("truncated Mach-O load commands")
        cmd, cmdsize = struct.unpack_from("<II", binary, offset)
        if cmdsize < 8 or offset + cmdsize > len(binary):
            die("invalid Mach-O load command")
        if cmd == LC_SEGMENT_64:
            nsects = read_u32(binary, offset + 64)
            section_offset = offset + 72
            for _ in range(nsects):
                if section_offset + 80 > len(binary):
                    die("truncated Mach-O section list")
                sectname = struct.unpack_from("<16s", binary, section_offset)[0].split(b"\0", 1)[0].decode("ascii", "ignore")
                segname = struct.unpack_from("<16s", binary, section_offset + 16)[0].split(b"\0", 1)[0].decode("ascii", "ignore")
                addr, size = struct.unpack_from("<QQ", binary, section_offset + 32)
                file_offset = read_u32(binary, section_offset + 48)
                sections[(segname, sectname)] = (addr, size, file_offset)
                section_offset += 80
        offset += cmdsize
    return sections


def encryption_cryptid(binary):
    if len(binary) < 32 or read_u32(binary, 0) != MH_MAGIC_64:
        die("Twitter executable is not a supported Mach-O")
    header = struct.unpack_from("<IiiIIIII", binary, 0)
    ncmds = header[4]
    offset = 32
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from("<II", binary, offset)
        if cmdsize < 8 or offset + cmdsize > len(binary):
            die("invalid Mach-O load command")
        if cmd == LC_ENCRYPTION_INFO_64:
            return read_u32(binary, offset + 16)
        offset += cmdsize
    return None


def parse_method_list(binary, address):
    if not address or address + 8 > len(binary):
        return {}
    entsize_flags, count = struct.unpack_from("<II", binary, address)
    small = bool(entsize_flags & 0x80000000)
    direct_selectors = bool(entsize_flags & 0x40000000)
    entry_size = entsize_flags & 0xFFFF
    if entry_size == 0 or count > 10000:
        return {}
    methods = {}
    base = address + 8
    for index in range(count):
        entry = base + index * entry_size
        if entry + entry_size > len(binary):
            break
        if small:
            if entry_size < 12:
                break
            name_offset, types_offset, _ = struct.unpack_from("<iii", binary, entry)
            name_address = entry + name_offset
            if direct_selectors:
                name = read_cstring(binary, name_address)
            elif 0 <= name_address <= len(binary) - 8:
                name = read_cstring(binary, read_u64(binary, name_address) & PTR_MASK)
            else:
                name = None
            types = read_cstring(binary, entry + 4 + types_offset)
        else:
            if entry_size < 24:
                break
            name_ptr, types_ptr, _ = struct.unpack_from("<QQQ", binary, entry)
            name = read_cstring(binary, name_ptr & PTR_MASK)
            types = read_cstring(binary, types_ptr & PTR_MASK)
        if name:
            methods[name] = types or ""
    return methods


def parse_objc_classes(binary):
    sections = parse_sections(binary)
    classlist = sections.get(("__DATA_CONST", "__objc_classlist")) or sections.get(("__DATA", "__objc_classlist"))
    if not classlist:
        return {}
    _, size, file_offset = classlist
    classes = {}
    for relative in range(0, size, 8):
        slot = file_offset + relative
        if slot + 8 > len(binary):
            break
        class_address = read_u64(binary, slot) & PTR_MASK
        if not class_address or class_address + 40 > len(binary):
            continue
        try:
            class_data = read_u64(binary, class_address + 32) & PTR_MASK
            class_ro = class_data & ~0x7
            if not class_ro or class_ro + 72 > len(binary):
                continue
            ro = struct.unpack_from("<IIIIQQQQQQQ", binary, class_ro)
            name = read_cstring(binary, ro[5] & PTR_MASK)
            if not name:
                continue
            classes[name] = parse_method_list(binary, ro[6] & PTR_MASK)
        except (struct.error, IndexError):
            continue
    return classes


def verify_required_methods(zf):
    for binary_path, required_classes in REQUIRED_METHODS.items():
        try:
            binary = zf.read(binary_path)
        except KeyError:
            die(f"missing required framework binary: {binary_path}")
        classes = parse_objc_classes(binary)
        for class_name, expected_methods in required_classes.items():
            methods = classes.get(class_name)
            if methods is None:
                die(f"required Objective-C class missing: {class_name}")
            for selector, expected_types in expected_methods.items():
                actual_types = methods.get(selector)
                if actual_types is None:
                    die(f"required selector missing: {class_name} {selector}")
                if actual_types != expected_types:
                    die(
                        f"method signature changed: {class_name} {selector}; "
                        f"expected {expected_types!r}, got {actual_types!r}"
                    )
                print(f"objc={class_name} {selector} {actual_types}")


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

        verify_required_methods(zf)

    print("[x-nekama] IPA compatibility check passed")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        die("usage: verify_ipa.py path/to/X.ipa")
    main(sys.argv[1])
