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

   `database/assistant/003_assistant_briefing.sql` fills it in with figures
   that are true by definition: invoices raised today, jobs opened today, and
   invoices raised in the last seven days, each scoped to the signed-in
   client, company, branch, and financial year. Run it after 001.

   It deliberately leaves out "pending approvals" and "overdue invoices".
   Neither can be derived from this schema without a business rule:
   `approvedFlag` is NULL on 73% of invoices, `dueDate` says nothing about
   settlement (176,245 invoices are past due), `deletedNo` holds arbitrary
   numbers rather than a flag, and `cancelStatus` is unused. Supply the rule
   and each becomes one more `UNION ALL` branch.

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

## Approved data queries

"What's our total outstanding this month?" can be answered without opening a
report by running an approved read-only procedure.

1. Run `database/assistant/002_assistant_data_queries.sql`.
2. For each question type, write a read-only procedure and add a row to
   `tblAssistantDataQuery`: a key, a title (spoken in answers), a description
   (tells the AI when to use it), the procedure name, its user parameters
   (JSON: name, type `string` | `number` | `date`, description), and which
   session values it takes (`clientId,userId,companyId,branchId,finYearId`).
   An example is commented in the script.
3. Give the application login EXECUTE on those procedures only. Keeping them
   read-only is the DBA's responsibility; the API cannot check what a
   procedure does.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/queries` | The catalog for the user's client, without procedure names |
| POST | `/query` | `{ key, params, companyId, branchId, finYearId }` returns `{ title, columns, rows }` (200 rows max) |

Only catalog entries can run, only with their declared parameters, each value
bound and type-checked. Session values come from the token, and a parameter
named like one (`clientId` and so on) is ignored, so a caller cannot read
another client's data. The frontend phrases results in the browser; results are
never sent to the AI.

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
