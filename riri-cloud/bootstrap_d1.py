"""Cloudflare D1 bootstrap using a user-scoped API token. No credentials are logged."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
name = "riri-qwen-d1"
base = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database"

def call(method, url, body=None):
    req = Request(url, data=json.dumps(body).encode() if body else None, method=method,
                  headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(req, timeout=30) as f:
        result = json.load(f)
    if not result.get("success"):
        raise RuntimeError("Cloudflare D1 API operation failed")
    return result["result"]

items = call("GET", base + "?per_page=100")
matches = [d for d in items if d.get("name") == name]
if len(matches) > 1:
    raise RuntimeError("Multiple D1 databases share the same name")
db = matches[0] if matches else call("POST", base, {"name": name})
id_ = db.get("uuid") or db.get("id")
if not id_ or len(id_) < 32:
    raise RuntimeError("Cloudflare did not provide D1 UUID")
path = Path(__file__).with_name("wrangler.toml")
source = path.read_text()
source = source.replace("REPLACE_WITH_YOUR_D1_UUID", id_).replace(
    "REPLACE_WITH_OWN_NUMERIC_X_ID", os.environ["OWN_USER_ID"])
path.write_text(source)
print("Configured D1 database and Worker with owner ID; no secret values printed")
