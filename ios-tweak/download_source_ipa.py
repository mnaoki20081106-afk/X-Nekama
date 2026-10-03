#!/usr/bin/env python3
"""Download only the pinned private X IPA; credentials never enter files/logs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import zipfile


def download(session, file_id, output):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', file_id):
        raise ValueError('Invalid Drive file ID')
    endpoint = f'https://www.googleapis.com/drive/v3/files/{file_id}'
    response = session.get(endpoint, params={'fields': 'name,size,md5Checksum', 'supportsAllDrives': 'true'}, timeout=60)
    response.raise_for_status()
    metadata = response.json()
    if not metadata.get('name', '').lower().endswith('.ipa'):
        raise ValueError('Drive source is not an IPA')
    expected_size = int(metadata['size'])
    if not 0 < expected_size <= 1024 * 1024 * 1024:
        raise ValueError('Unexpected source IPA size')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + '.part')
    digest = hashlib.md5()
    received = 0
    try:
        with session.get(endpoint, params={'alt': 'media', 'supportsAllDrives': 'true'}, stream=True, timeout=120) as data:
            data.raise_for_status()
            with partial.open('wb') as target:
                for chunk in data.iter_content(chunk_size=1024 * 1024):
                    received += len(chunk)
                    if received > expected_size:
                        raise ValueError('Download exceeds Drive metadata size')
                    target.write(chunk)
                    digest.update(chunk)
        if received != expected_size:
            raise ValueError('Incomplete IPA download')
        if metadata.get('md5Checksum') and digest.hexdigest() != metadata['md5Checksum']:
            raise ValueError('Drive checksum mismatch')
        with zipfile.ZipFile(partial) as archive:
            if archive.testzip() is not None:
                raise ValueError('Corrupt IPA archive')
        partial.replace(output)
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = os.environ.get('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', '')
    if not raw:
        raise ValueError('Configure GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON in Actions secrets')
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=['https://www.googleapis.com/auth/drive.readonly'])
    with AuthorizedSession(credentials) as session:
        download(session, os.environ['X_IPA_DRIVE_FILE_ID'], args.output)
    print('Private Drive IPA downloaded and checked')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # HTTP/auth exceptions can contain provider URLs or credential details.
        print('Source IPA download failed. Check the Actions secret, Drive API enablement, and source-file viewer permission.', file=sys.stderr)
        sys.exit(1)
