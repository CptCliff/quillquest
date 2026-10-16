# Hosting Quillquest yourself, for friends, over Tailscale

This runs the whole game on one machine you control, reachable only by people on your Tailscale network. Nothing is opened to the public
internet and no router settings change. Sign-in uses the Tailscale identity of whoever connects, so there are no passwords and no accounts
to create. (Supabase sign-in is still there as an option: see "Other sign-in" at the end.)

**What was and wasn't tested.** The pieces were run for real on one machine without Docker: production builds of the web app and the game
server, a real Postgres 16, a stand-in for the proxy that adds Tailscale's headers, two browsers signing in as different people, an invite,
and live co-writing through the same-origin socket. The Docker Compose file validates (`docker compose config`), but **the images were not built
or started** where this was written (no Docker daemon was available). Expect to fix a small thing or two on your first `up`, and tell me what it says.

## What runs
| Service | What it is |
|---|---|
| `postgres` | the database (Postgres 16; data in the `pgdata` volume) |
| `sync` | the game server (live editing + the game API) |
| `web` | the website |
| `proxy` | Caddy, the one door: `/collab` and `/api` go to `sync`, the rest to `web` |
| `tailscale` | joins your tailnet and serves `https://<name>.<your-tailnet>.ts.net` to the proxy, with a real certificate |

None of them publishes a port on your machine. The only way in is the Tailscale service.

## 1. The machine
Any always-on computer: a mini PC, a spare laptop, a small server. 2 GB of RAM and a couple of cores is plenty for a few friends.
- **A laptop:** set it to never sleep while plugged in, and keep it plugged in. Closing the lid takes the game offline unless the OS is told not to sleep.
- Install Docker with the Compose plugin (https://docs.docker.com/engine/install/). On Windows or macOS, Docker Desktop.
- Get this repository onto it: `git clone https://github.com/CptCliff/quillquest && cd quillquest`.

## 2. Tailscale
1. Make a Tailscale account (https://login.tailscale.com). The free personal plan covers a small group; check its current limits.
2. In the admin console **DNS** page, turn on **MagicDNS** and **HTTPS Certificates**. (The game needs HTTPS: browsers only allow some features on secure pages.)
3. **Settings > Keys > Generate auth key.** A reusable key is easiest. Copy it.
4. After the machine joins (step 3), open **Machines**, find it, and choose **Disable key expiry** so it does not drop off the network after 180 days.

## 3. Start it
```
cd deploy
./setup.sh            # creates .env with fresh random secrets
```
Open `deploy/.env` and set:
- `TS_AUTHKEY` to the key from step 2.
- `QUILLQUEST_TAILNET_ALLOW` to the Tailscale logins (emails) of you and each friend, comma-separated. Leave it empty to let anyone on your tailnet in.
- `TS_HOSTNAME` if you want a different machine name than `quillquest`.

Then:
```
docker compose up -d --build
docker compose logs -f tailscale      # wait for "serve" to report your address, then Ctrl-C
```
The game is at `https://quillquest.<your-tailnet>.ts.net` (the exact name is on the Machines page). The first build takes several minutes.

## 4. Friends
Each friend needs a Tailscale account and to reach the machine. Two ways:
- **Share the machine** (keeps their tailnet separate from yours): in **Machines**, open the menu on `quillquest` and choose **Share**, then invite their email.
- **Invite them to your tailnet:** **Users > Invite**. Simpler, but they become members of your network, and your plan's user limit applies.

They then install the Tailscale app, accept, and open the address. They sign in automatically as their Tailscale identity; their display name starts as their Tailscale name and they can change it. The first person to make a campaign is its GM; everyone else joins by the invite link the GM makes in the Director tab.

If someone sees "This table is only open to people on its Tailscale network who are on the guest list": Tailscale is off on their device, or their email is not in `QUILLQUEST_TAILNET_ALLOW`. After editing `.env`, run `docker compose up -d`.

## Backups
Everything lives in one database. `./backup.sh` writes a compressed copy to `deploy/backups/` (keeping the newest 14). To run it nightly: `crontab -e` and add
`15 3 * * * cd /path/to/quillquest/deploy && ./backup.sh`. Copy the backups somewhere else now and then (another disk, cloud storage): a backup on the same disk dies with the disk.
Restore with `./restore.sh backups/<file>.sql.gz`, then `docker compose restart sync`.

## Updating
```
git pull
cd deploy && docker compose up -d --build
```
The database upgrades itself on start. Take a backup first.

## Checking the model and email
With the Claude assistant or email configured in `.env` (see `docs/llm-providers.md`, `docs/mail-providers.md`), run the checks inside the container:
`docker compose exec sync pnpm --filter @quillquest/sync check:services`

## How sign-in stays safe
- `tailscale serve` (not Funnel, which is switched off in `tailscale-serve.json`) puts the caller's verified Tailscale login on each request. The game server accepts that
  only with a shared secret that the proxy adds (`X-Quillquest-Proxy`); a request that did not come through the proxy, with forged headers or not, is refused.
- The browser trades that once for a signed token (twelve hours) and uses the token for everything after, including the live socket. The token is signed with `QUILLQUEST_SESSION_SECRET`.
- The guest list (`QUILLQUEST_TAILNET_ALLOW`) is checked every time a token is issued. Removing someone stops new sign-ins; a token already issued stays valid until it expires.
- The secrets in `deploy/.env` are generated by `setup.sh`; do not commit that file (it is in `.gitignore`), and keep it private. Changing the session secret signs everyone out.
- Do not add `ports:` to any service, and do not turn on Funnel: either would put the game where the identity headers can no longer be trusted.

## Other sign-in
Set `SUPABASE_URL` (and `SUPABASE_JWT_SECRET` for older projects) in `.env`, and the two `NEXT_PUBLIC_SUPABASE_*` values, then `docker compose up -d --build`.
Supabase tokens are then accepted beside Tailscale ones. See `docs/supabase-setup.md`. Another sign-in service would be one more class beside `apps/sync/src/auth/tailnet.ts`.

## If something is wrong
| Symptom | Look at |
|---|---|
| The address does not load | `docker compose logs tailscale` (is it logged in? did you enable HTTPS certificates?) |
| 502 / bad gateway | `docker compose ps`; `docker compose logs sync web` |
| The page loads but never connects | `docker compose logs proxy sync`; the socket path is `/collab` |
| The sync server will not start | `docker compose logs sync` names the missing setting |
