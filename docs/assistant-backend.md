# Artin Assistant Backend

Server side of the Artin assistant in `mainCode-NextJs-SQL`:

- Notes, reminders, timers, and memory saved per user, so they follow the user
  to every browser and device.
- Reminders delivered as browser push notifications, even when every tab of
  the app is closed.
- Business counts for the daily briefing ("3 pending approvals and 2 overdue
  invoices").

## Setup

1. **Database.** Run `database/assistant/001_assistant_storage.sql` on each
   client database. It is idempotent and needs SQL Server 2016 SP1 or later.
   It creates `tblAssistantItem`, `tblAssistantPushSubscription`, and the
   `assistantDailySummary` procedure.

2. **Briefing counts.** `assistantDailySummary` is a template that returns no
   rows. Replace its body with your own queries; each row is a `label`
   (plural noun phrase) and a `value` (count). An example is in the script.

3. **Push keys.** Generate a key pair once per environment:

   ```sh
   npx web-push generate-vapid-keys
   ```

   Add to `.env`:

   ```dotenv
   ASSISTANT_PUSH_ENABLED=true
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>   # secret; never commit
   VAPID_SUBJECT=mailto:<support address>
   ```

   Changing the key pair invalidates every existing subscription; users turn
   the reminder setting on again.

4. Restart the server. Until the SQL script has run, the endpoints return
   errors (logged) and the frontend keeps working from the browser's copy.

## Endpoints

All under `/Sql/api/assistant`, all behind `auth.verifyToken`. The user and
client come from the token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/items` | The user's items, including deletions from the last 30 days |
| POST | `/items/sync` | `{ items: [...] }` upserts, last write wins by `updatedAt` |
| GET | `/push/config` | `{ enabled, publicKey }` |
| POST | `/push/subscribe` | `{ subscription }` from `PushManager.subscribe()` |
| POST | `/push/unsubscribe` | `{ endpoint }` |
| POST | `/summary` | `{ companyId, branchId, finYearId }` returns `[{ label, value }]` |

## How reminders are delivered

A cron job runs every minute and atomically claims reminders that are due
(`UPDATE ... OUTPUT`), so several server instances never send one twice. It
waits 60 seconds after the due time: an open tab fires the reminder itself and
syncs its deletion first, so the user is not alerted twice. Reminders more
than six hours overdue are not sent. Expired subscriptions (HTTP 404/410) are
removed.

## Notes

- Times are stored as epoch milliseconds so server time zones and the driver's
  UTC setting cannot move a reminder.
- Item text is limited to 1,000 characters and 200 items per sync request.
