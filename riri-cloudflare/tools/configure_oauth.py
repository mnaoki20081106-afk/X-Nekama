"""Embed public PKCE client configuration; never embed a client secret."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

p = argparse.ArgumentParser()
p.add_argument("--client-id", required=True)
p.add_argument("--redirect-uri", required=True)
p.add_argument("--scopes", required=True)
p.add_argument("--tweak-dir", type=Path, default=Path(__file__).resolve().parents[2] / "riri-tweak")
args = p.parse_args()
url = urlparse(args.redirect_uri)
if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
    p.error("redirect-uri must be the registered, publisher-owned HTTPS callback URL")
if not args.client_id.strip() or not args.scopes.strip() or any(ord(c) < 32 for c in args.client_id + args.scopes):
    p.error("provide the real public client ID and registered space-separated scope IDs")
values = {"CLIENT_ID": args.client_id, "REDIRECT_URI": args.redirect_uri, "SCOPES": args.scopes, "CALLBACK_SCHEME": "riri-cloudflare"}
args.tweak_dir.joinpath("RiriOAuthConfig.h").write_text(
    "// Public client, token_endpoint_auth_method=none, PKCE S256.\n"
    + "\n".join("#define RIRI_CF_" + key + " " + json.dumps(value) for key, value in values.items()) + "\n"
)
