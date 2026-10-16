#!/usr/bin/env sh
# Creates deploy/.env from the example with fresh random secrets. Safe to run again: it never overwrites an existing .env.
set -eu
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then echo "Docker is not installed. See docs/self-hosting.md, step 1." >&2; exit 1; fi
if ! docker compose version >/dev/null 2>&1; then echo "Docker Compose (the 'docker compose' command) is missing. See docs/self-hosting.md, step 1." >&2; exit 1; fi

if [ -f .env ]; then
  echo ".env already exists; leaving it alone. Delete it first if you want new secrets (that signs everyone out)."
  exit 0
fi

rand() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }

umask 077
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 16)|" \
  -e "s|^QUILLQUEST_SESSION_SECRET=.*|QUILLQUEST_SESSION_SECRET=$(rand 32)|" \
  -e "s|^QUILLQUEST_PROXY_SECRET=.*|QUILLQUEST_PROXY_SECRET=$(rand 16)|" \
  .env.example > .env

echo "Created deploy/.env with fresh secrets."
echo "Next: open it and set TS_AUTHKEY (and QUILLQUEST_TAILNET_ALLOW), then run:  docker compose up -d --build"
