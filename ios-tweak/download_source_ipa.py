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


def get_session():
    raw = os.environ.get('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON', '')
    if not raw:
        raise ValueError('missing_credentials')
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError('invalid_credentials_json') from exc

    required = ('client_email', 'private_key', 'token_uri')
    if any(not info.get(key) for key in required):
        raise ValueError('invalid_credentials_fields')

    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession

    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/drive.readonly'])
    return AuthorizedSession(credentials), info['client_email']


def probe(session, file_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', file_id):
        raise ValueError('invalid_file_id')
    endpoint = f'https://www.googleapis.com/drive/v3/files/{file_id}'
    response = session.get(
        endpoint,
        params={
            'fields': 'id,name,size,md5Checksum,mimeType',
            'supportsAllDrives': 'true',
        },
        timeout=60,
    )
    if getattr(response, 'status_code', None) in (401, 403, 404):
        raise PermissionError('source_not_accessible')
    response.raise_for_status()
    metadata = response.json()

    if not metadata.get('name', '').lower().endswith('.ipa'):
        raise ValueError('source_not_ipa')
    expected_size = int(metadata.get('size') or 0)
    if not 0 < expected_size <= 1024 * 1024 * 1024:
        raise ValueError('unexpected_source_size')
    return endpoint, metadata, expected_size


def download(session, file_id, output):
    endpoint, metadata, expected_size = probe(session, file_id)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_suffix(output.suffix + '.part')
    digest = hashlib.md5()
    received = 0
    try:
        with session.get(
            endpoint,
            params={'alt': 'media', 'supportsAllDrives': 'true'},
            stream=True,
            timeout=120,
        ) as data:
            if getattr(data, 'status_code', None) in (401, 403, 404):
                raise PermissionError('source_not_accessible')
            data.raise_for_status()
            with partial.open('wb') as target:
                for chunk in data.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    received += len(chunk)
                    if received > expected_size:
                        raise ValueError('download_exceeds_metadata_size')
                    target.write(chunk)
                    digest.update(chunk)
        if received != expected_size:
            raise ValueError('incomplete_download')
        if metadata.get('md5Checksum') and digest.hexdigest() != metadata['md5Checksum']:
            raise ValueError('drive_checksum_mismatch')
        with zipfile.ZipFile(partial) as archive:
            if archive.testzip() is not None:
                raise ValueError('corrupt_ipa')
        partial.replace(output)
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()

    if not args.check_only and not args.output:
        parser.error('--output is required unless --check-only is used')

    file_id = os.environ.get('X_IPA_DRIVE_FILE_ID', '')
    if not file_id:
        raise ValueError('missing_file_id')

    session, client_email = get_session()
    try:
        if args.check_only:
            _, metadata, expected_size = probe(session, file_id)
            print(f"Drive access OK: {metadata['name']} ({expected_size} bytes)")
            print(f'Service account viewer: {client_email}')
            return
        download(session, file_id, args.output)
        print('Private Drive IPA downloaded and checked')
    finally:
        session.close()


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        print(
            'Source IPA is not accessible to the configured service account. '
            'Share only X.ipa with the service account client_email as Viewer '
            'and make sure the Google Drive API is enabled.',
            file=sys.stderr,
        )
        sys.exit(2)
    except ValueError as exc:
        reason = str(exc)
        messages = {
            'missing_credentials': 'Configure GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON in GitHub Actions secrets.',
            'invalid_credentials_json': 'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON.',
            'invalid_credentials_fields': 'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is missing required service-account fields.',
            'missing_file_id': 'X_IPA_DRIVE_FILE_ID is not configured.',
            'invalid_file_id': 'X_IPA_DRIVE_FILE_ID is invalid.',
            'source_not_ipa': 'The configured Drive source is not an IPA.',
            'unexpected_source_size': 'The configured Drive source has an unexpected size.',
            'download_exceeds_metadata_size': 'Downloaded IPA exceeded the Drive metadata size.',
            'incomplete_download': 'The IPA download was incomplete.',
            'drive_checksum_mismatch': 'The downloaded IPA did not match the Drive checksum.',
            'corrupt_ipa': 'The downloaded source IPA is corrupt.',
        }
        print(messages.get(reason, 'Source IPA validation failed.'), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # HTTP/auth exceptions can contain provider URLs or credential details.
        print(
            'Source IPA access failed. Check the Actions secret, Drive API enablement, '
            'and source-file Viewer permission.',
            file=sys.stderr,
        )
        sys.exit(1)
