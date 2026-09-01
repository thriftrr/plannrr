#!/usr/bin/env bash
# Deploy Plannrr to Cloudflare Workers (thriftrr account).
#   npm run deploy
# Prereqs: `npx wrangler whoami` shows you logged in.
set -euo pipefail
# Account comes from the environment or .env (NUXT_CF_ACCOUNT_ID) — the same
# account id used for Cloudflare Email Sending.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -f .env ]; then
  CLOUDFLARE_ACCOUNT_ID=$(grep -E '^NUXT_CF_ACCOUNT_ID=' .env | cut -d= -f2-)
fi
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "Set CLOUDFLARE_ACCOUNT_ID (or NUXT_CF_ACCOUNT_ID in .env)"; exit 1; }
export CLOUDFLARE_ACCOUNT_ID

echo "── build (cloudflare preset)"
NITRO_PRESET=cloudflare_module npm run build

echo "── patch database_name into the generated wrangler.json"
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('.output/server/wrangler.json')
cfg = json.loads(p.read_text())
cfg['d1_databases'][0]['database_name'] = 'ynabrr-db'
p.write_text(json.dumps(cfg, indent=2))
PY

echo "── apply pending D1 migrations"
# NOTE: Cloudflare's D1 HTTP API throws transient internal errors (code 7500),
# hence the retries. Separately, wrangler's batch runner chokes on some
# drizzle-style files (we hit it on 0002): if apply keeps failing on a real
# migration, run its statements individually with
# `wrangler d1 execute ynabrr-db --remote --command '…'` and INSERT its
# filename into _hub_migrations.
applied=0
for attempt in 1 2 3 4; do
  if npx wrangler --cwd .output/server d1 migrations apply DB --remote; then
    applied=1; break
  fi
  echo "…transient D1 API error, retrying ($attempt/4)"; sleep 10
done
[ "$applied" = 1 ] || { echo "✘ migrations could not be applied — NOT deploying"; exit 1; }

echo "── deploy"
npx wrangler --cwd .output deploy

echo "✔ https://plannrr.thriftrr.workers.dev"
