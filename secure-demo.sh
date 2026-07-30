#!/usr/bin/env bash
# Secure HTTPS front for the demo stack (mic + autoplay need a secure origin).
# Unified origin via Caddy :8080 (app + /api + /sites), exposed through a
# Cloudflare quick tunnel. NOTE: the trycloudflare URL changes on restart —
# a custom domain with a named tunnel is the permanent fix.
set -euo pipefail
cd /root/deedwell
ss -tlnp 2>/dev/null | grep ':8080' | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill || true
pgrep -x cloudflared | xargs -r kill || true
sleep 1
setsid caddy run --config infrastructure/secure-demo/Caddyfile < /dev/null > /tmp/caddy-demo.log 2>&1 &
setsid cloudflared tunnel --url http://localhost:8080 < /dev/null > /tmp/tunnel.log 2>&1 &
for i in $(seq 1 20); do
  sleep 2
  URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log | head -1 || true)
  [ -n "$URL" ] && break
done
echo "${URL:-FAILED}" > .tunnel-url
echo "Secure workspace: ${URL:-tunnel failed — check /tmp/tunnel.log}"
curl -s --max-time 15 -o /dev/null -w "https check: %{http_code}\n" "${URL}/" || true
