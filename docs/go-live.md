# Going live: real sign-in, a real model, real mail

Everything so far has run against fakes. This is the shortest path to running against the real services, and a tool that tells you
what is wrong before a player does. Only you can create the accounts and keys; nothing here needs them committed to the repo
(put them in your host's environment settings or a local, untracked `.env`).

## 1. Sign-in (Supabase)
Follow `docs/supabase-setup.md` steps 1 to 3. Then, with the same variables exported in your shell:

```
SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
pnpm --filter @quillquest/sync check:services --only=sign-in
```
It checks that the project answers, that signing keys are published (or `SUPABASE_JWT_SECRET` is set for an older HS256 project),
that the dev sign-in switches are off, and that the web variables are present. It cannot check a real sign-in: do the six-step
"Try it" list at the end of `docs/supabase-setup.md`, and tell me anything that loops, 401s or says "Not your table".

## 2. A model (the Claude assistant)
Pick one (`docs/llm-providers.md`):
```
QUILLQUEST_LLM=anthropic ANTHROPIC_API_KEY=<key> QUILLQUEST_LLM_MODEL=<model id> \
pnpm --filter @quillquest/sync check:services --only=model
```
or a local or vendor model: `QUILLQUEST_LLM=openai-compat QUILLQUEST_LLM_URL=http://localhost:11434 QUILLQUEST_LLM_MODEL=<name>`.

This asks the model every kind of question the game asks (Skill match, chapter grants, adapting a chapter template, Belief check,
Belief challenges, Dangers, NPC lines, the oracle) and reports, per kind, whether the strict parsers accepted the answer and how long it
took. A kind that fails is a kind players will see "the assistant gave an answer the game could not use" for. A weak local model
will fail some; that is the information you want. Costs a handful of short requests.

## 3. Mail (Resend)
Create a Resend account and verify a sending domain (or use their test sender), then:
```
QUILLQUEST_MAIL=resend RESEND_API_KEY=<key> QUILLQUEST_MAIL_FROM="Quillquest <play@yourdomain>" \
pnpm --filter @quillquest/sync check:services --only=mail --send-to=you@example.com
```
That sends exactly one test message. Check the inbox and the spam folder. `QUILLQUEST_PUBLIC_URL` must be the web app's address so the
links in real emails open the right place.

## 4. Everything together
Run `pnpm --filter @quillquest/sync check:services` with the full production environment. It exits 1 if anything fails. Then start the
sync server with `NODE_ENV=production`; it refuses to start on a dev switch, a fake provider, or a missing `DATABASE_URL`.

## What the checks do not cover
A live sign-in end to end, the database role (it must bypass row-level security), and anything about hosting. After the checks pass, a
playtest with real people (or the agents in `apps/web/playtest/`, pointed at the real stack) is the real test.
