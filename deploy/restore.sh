#!/usr/bin/env sh
# Restores a backup made by backup.sh into the running database. This REPLACES what is there.
set -eu
cd "$(dirname "$0")"
file="${1:?usage: ./restore.sh backups/quillquest-YYYYMMDD-HHMMSS.sql.gz}"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
printf "This replaces the current database with %s. Type 'yes' to continue: " "$file"
read -r answer
[ "$answer" = "yes" ] || { echo "Cancelled."; exit 1; }
gunzip -c "$file" | docker compose exec -T postgres psql -U quillquest -d quillquest -v ON_ERROR_STOP=1
echo "Restored. Restart the game server so it reloads: docker compose restart sync"
