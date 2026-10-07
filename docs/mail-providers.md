# Email for async play

The server tells people when the story is waiting on them and they are away. Mail goes through one small interface (`apps/sync/src/mail/types.ts`): `send({to, subject, text})`.
Addresses come from sign-in (`profiles.email`), never from a client request.

## Configure (server environment)
| `QUILLQUEST_MAIL` | Also needed | Notes |
|---|---|---|
| unset / `none` | | Nothing is emailed; the rest of the game is unchanged. |
| `resend` | `RESEND_API_KEY`, `QUILLQUEST_MAIL_FROM` (`QUILLQUEST_MAIL_URL` optional) | Resend's HTTP API by plain `fetch`. **Not run against the real service here**; the request shape is tested against a stub server. |
| `log` | | Prints mail to the console (local development). Refused in production. |
| `fake` | | Records mail in memory. Tests and browser runs. Refused in production. |

`QUILLQUEST_PUBLIC_URL` is the origin that links start from. `QUILLQUEST_DEV_MAIL=1` (with dev sign-in and the fake mailer) mounts `/api/dev/mail` (read the outbox), `/api/dev/mail/advance` (move the notifier's clock) and `/api/dev/mail/tick`.
To add a provider, write a class with `name` and `send` and add a case to `mailerFromEnv`. SMTP would need the `nodemailer` dependency (mind the pnpm release-age rule).

## Behaviour (design plan 10)
- **Batching:** messages wait two minutes and combine into one email per person per campaign.
- **Presence:** nobody is emailed while they have the campaign open; their queued messages for that moment are dropped.
- **Preferences:** per campaign, immediate (batched), a daily digest, or off (`GET/PUT /api/campaigns/:c/prefs`).
- **Reminders** go out once (a dedupe key). A GM-set "stall hours" limit reminds the GM when a card or battle has waited too long.
- **Restarts:** the queue is in Postgres (`notification_queue`), so a restart loses nothing. Without a database it lives in memory.
- A background job runs every 30 seconds: mail batches, push windows that ran out, and stalled-card reminders.
