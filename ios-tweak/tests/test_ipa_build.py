import hashlib
import io
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from download_source_ipa import download
from verify_built_ipa import verify_injection


def archive_bytes():
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        archive.writestr('Payload/Twitter.app/Info.plist', 'fixture')
    return data.getvalue()


class Response:
    def __init__(self, metadata=None, data=b''):
        self.metadata, self.data = metadata, data
    def raise_for_status(self):
        pass
    def json(self):
        return self.metadata
    def iter_content(self, chunk_size):
        yield self.data
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


class Session:
    def __init__(self, data, size=None, md5=None):
        self.data = data
        self.calls = []
        self.metadata = {'name': 'X.ipa', 'size': str(len(data) if size is None else size),
                         'md5Checksum': md5 or hashlib.md5(data).hexdigest()}
    def get(self, endpoint, **kwargs):
        self.calls.append((endpoint, kwargs))
        return Response(data=self.data) if kwargs.get('stream') else Response(metadata=self.metadata)


def executable(loads):
    commands = []
    for load in loads:
        path = load.encode() + b'\0'
        size = (24 + len(path) + 7) // 8 * 8
        commands.append(struct.pack('<IIIIII', 12, size, 24, 0, 0, 0) + path + b'\0' * (size - 24 - len(path)))
    return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x100000C, 0, 2, len(commands), sum(map(len, commands)), 0, 0) + b''.join(commands)


class IPABuildTests(unittest.TestCase):
    def test_private_download_uses_drive_api_and_checks_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'source.ipa'
            data = archive_bytes()
            session = Session(data)
            download(session, 'verified-file', target)
            self.assertEqual(target.read_bytes(), data)
            self.assertEqual(len(session.calls), 2)
            self.assertEqual(session.calls[1][1]['params']['alt'], 'media')
            self.assertFalse(target.with_suffix('.ipa.part').exists())

    def test_bad_download_never_overwrites_an_existing_source(self):
        for session in [Session(b'<html>login</html>'), Session(archive_bytes(), size=9999),
                        Session(archive_bytes(), md5='wrong')]:
            with tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / 'source.ipa'
                target.write_bytes(b'previous source')
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    download(session, 'verified-file', target)
                self.assertEqual(target.read_bytes(), b'previous source')
                self.assertFalse(target.with_suffix('.ipa.part').exists())

    def test_invalid_file_id_never_makes_a_request(self):
        session = Session(archive_bytes())
        with self.assertRaises(ValueError):
            download(session, '../other', 'unused.ipa')
        self.assertEqual(session.calls, [])

    def test_built_ipa_requires_exactly_one_resolvable_injection(self):
        for loads in [[], ['@rpath/XNekama.dylib'], ['@rpath/XNekama.dylib'] * 2,
                      ['/Library/XNekama.dylib']]:
            with tempfile.TemporaryDirectory() as directory:
                ipa = Path(directory) / 'test.ipa'
                with zipfile.ZipFile(ipa, 'w') as archive:
                    archive.writestr('Payload/Twitter.app/Twitter', executable(loads))
                    archive.writestr('Payload/Twitter.app/Frameworks/XNekama.dylib', executable([]))
                if loads == ['@rpath/XNekama.dylib']:
                    verify_injection(ipa)
                else:
                    with self.assertRaises(ValueError):
                        verify_injection(ipa)


if __name__ == '__main__':
    unittest.main()
