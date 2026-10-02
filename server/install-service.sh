#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run on the target Linux server as root.' >&2; exit 1; }
command -v nft >/dev/null
command -v node >/dev/null
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 24 ]]
[[ -f /opt/xnekama/server.mjs ]] || { echo 'Install the source at /opt/xnekama first.' >&2; exit 1; }
id xnekama >/dev/null 2>&1 || useradd --system --home /var/lib/xnekama --shell /usr/sbin/nologin xnekama
app_uid=$(id -u xnekama)
install -d -m 700 -o xnekama -g xnekama /var/lib/xnekama
# Stop this service before replacing its own table; never flush other firewall rules.
systemctl stop xnekama 2>/dev/null || true
if nft list table inet xnekama_egress >/dev/null 2>&1; then nft delete table inet xnekama_egress; fi
cat > /etc/xnekama-egress.nft <<NFT
table inet xnekama_egress {
 chain output {
  type filter hook output priority 0; policy accept;
  meta skuid $app_uid ct direction reply accept
  meta skuid $app_uid ip daddr 127.0.0.1 tcp dport 40000 accept
  meta skuid $app_uid ip6 daddr ::1 tcp dport 40000 accept
  meta skuid $app_uid reject
 }
}
NFT
# Verify syntax before applying; connections other than local WARP are rejected.
nft -c -f /etc/xnekama-egress.nft
install -m 644 /opt/xnekama/server/xnekama.service /etc/systemd/system/xnekama.service
if [[ ! -f /etc/xnekama.env ]]; then
 umask 077
 secret=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
 password=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64url"))')
 cat > /etc/xnekama.env <<ENV
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/xnekama
WARP_PROXY_URL=socks5://127.0.0.1:40000
SERVER_GROK=0
APP_SECRET=$secret
ADMIN_PASSWORD=$password
ENV
 echo 'Created /etc/xnekama.env (credentials are not printed).'
fi
systemctl daemon-reload
systemctl enable xnekama
# Validate WARP and configure HTTPS before starting, as described in README.
echo 'Service installed. Configure WARP and HTTPS, then: systemctl start xnekama'
