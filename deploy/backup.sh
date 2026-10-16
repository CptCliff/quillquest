#!/usr/bin/env sh
# Writes a compressed copy of the whole database to deploy/backups/. Run it by hand, or from cron (docs/self-hosting.md, backups).
set -eu
cd "$(dirname "$0")"
mkdir -p backups
out="backups/quillquest-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U quillquest --clean --if-exists quillquest | gzip > "$out"
# Keep the newest 14.
ls -1t backups/quillquest-*.sql.gz 2>/dev/null | tail -n +15 | while read -r old; do rm -f "$old"; done
echo "Wrote $out"
