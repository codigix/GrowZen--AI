#!/usr/bin/env bash
# Deploys the latest main on the VPS. Run by GitHub Actions over SSH (see .github/workflows/deploy.yml),
# or by hand:  bash /var/www/GrowZen--AI/deploy.sh
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PM2_NAME="growzen"
HEALTH_URL="http://127.0.0.1:8000/api/v1/health"

# A non-interactive SSH session has a short PATH; make sure node, npm and pm2 are found.
export PATH="$PATH:/usr/local/bin:/usr/bin:/root/.nvm/versions/node/current/bin"

echo "==> Pulling latest code"
cd "$APP"
git fetch origin main
git reset --hard origin/main   # the server always matches GitHub; ignored files (.env, .venv, reports) are kept

echo "==> Backend: dependencies and database migrations"
cd "$APP/backend"
.venv/bin/pip install --quiet -r requirements.txt
.venv/bin/alembic upgrade head

echo "==> Frontend: build"
cd "$APP/frontend"
npm ci --no-audit --no-fund
npm run build

echo "==> Restarting $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env
pm2 save

echo "==> Health check"
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Healthy. Deployed $(git -C "$APP" rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "Health check failed after restart. Recent logs:" >&2
pm2 logs "$PM2_NAME" --lines 40 --nostream >&2 || true
exit 1
