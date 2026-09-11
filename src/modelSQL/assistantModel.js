// Storage for the Artin assistant. Tables are created by
// database/assistant/001_assistant_storage.sql. All values are bound as
// parameters; times are epoch milliseconds.
const { executeQuery } = require("./model");

const TOMBSTONE_DAYS = 30;
const STALE_REMINDER_MS = 6 * 60 * 60 * 1000;

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value); // mssql returns BIGINT as a string
  return Number.isFinite(number) ? number : null;
}

const UPSERT_ITEM = `
MERGE dbo.tblAssistantItem WITH (HOLDLOCK) AS target
USING (SELECT @userId AS userId, @itemKey AS itemKey) AS source
  ON target.userId = source.userId AND target.itemKey = source.itemKey
WHEN MATCHED AND target.updatedAtMs < @updatedAtMs THEN
  UPDATE SET
    kind = @kind,
    itemText = @itemText,
    lang = @lang,
    updatedAtMs = @updatedAtMs,
    deletedAtMs = @deletedAtMs,
    notifiedAtMs = CASE
      WHEN ISNULL(target.dueAtMs, -1) = ISNULL(CAST(@dueAtMs AS BIGINT), -1)
        THEN target.notifiedAtMs
      ELSE NULL
    END,
    dueAtMs = @dueAtMs
WHEN NOT MATCHED AND @deletedAtMs IS NULL THEN
  INSERT (clientId, userId, itemKey, kind, itemText, dueAtMs, lang, createdAtMs, updatedAtMs)
  VALUES (@clientId, @userId, @itemKey, @kind, @itemText, @dueAtMs, @lang, @createdAtMs, @updatedAtMs);`;

module.exports = {
  async listItems(userId) {
    const result = await executeQuery(
      `SELECT TOP (1000)
         itemKey AS id, kind, itemText AS text, dueAtMs AS dueAt, lang,
         createdAtMs AS createdAt, updatedAtMs AS updatedAt,
         deletedAtMs AS deletedAt, notifiedAtMs AS notifiedAt
       FROM dbo.tblAssistantItem
       WHERE userId = @userId AND (deletedAtMs IS NULL OR deletedAtMs > @since)
       ORDER BY updatedAtMs DESC`,
      { userId, since: Date.now() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000 },
    );
    return (result.recordset || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      text: row.text || "",
      dueAt: toNumber(row.dueAt),
      lang: row.lang || null,
      createdAt: toNumber(row.createdAt),
      updatedAt: toNumber(row.updatedAt),
      deletedAt: toNumber(row.deletedAt),
      notifiedAt: toNumber(row.notifiedAt),
    }));
  },

  async upsertItems({ userId, clientId }, items) {
    for (const item of items) {
      await executeQuery(UPSERT_ITEM, {
        userId,
        clientId,
        itemKey: item.id,
        kind: item.kind,
        itemText: item.text,
        dueAtMs: item.dueAt,
        lang: item.lang,
        createdAtMs: item.createdAt,
        updatedAtMs: item.updatedAt,
        deletedAtMs: item.deleted ? item.updatedAt : null,
      });
    }
  },

  // Claims due reminders atomically, so several server instances never send
  // the same reminder twice.
  async claimDueReminders(graceMs) {
    const now = Date.now();
    const result = await executeQuery(
      `UPDATE TOP (200) dbo.tblAssistantItem
       SET notifiedAtMs = @nowMs
       OUTPUT inserted.id, inserted.userId, inserted.itemKey, inserted.kind,
              inserted.itemText AS text, inserted.lang, inserted.dueAtMs AS dueAt
       WHERE kind IN (N'reminder', N'timer')
         AND deletedAtMs IS NULL
         AND notifiedAtMs IS NULL
         AND dueAtMs <= @cutoffMs
         AND dueAtMs > @oldestMs`,
      { nowMs: now, cutoffMs: now - graceMs, oldestMs: now - STALE_REMINDER_MS },
    );
    return result.recordset || [];
  },

  async saveSubscription({ userId, clientId }, subscription, userAgent) {
    await executeQuery(
      `MERGE dbo.tblAssistantPushSubscription WITH (HOLDLOCK) AS target
       USING (SELECT @endpoint AS endpoint) AS source ON target.endpoint = source.endpoint
       WHEN MATCHED THEN UPDATE SET
         userId = @userId, clientId = @clientId, p256dh = @p256dh,
         authKey = @authKey, userAgent = @userAgent, lastSeenAt = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (clientId, userId, endpoint, p256dh, authKey, userAgent)
         VALUES (@clientId, @userId, @endpoint, @p256dh, @authKey, @userAgent);`,
      {
        userId,
        clientId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        authKey: subscription.auth,
        userAgent,
      },
    );
  },

  async subscriptionsForUser(userId) {
    const result = await executeQuery(
      `SELECT endpoint, p256dh, authKey
       FROM dbo.tblAssistantPushSubscription WHERE userId = @userId`,
      { userId },
    );
    return result.recordset || [];
  },

  async deleteSubscription(userId, endpoint) {
    await executeQuery(
      `DELETE FROM dbo.tblAssistantPushSubscription
       WHERE userId = @userId AND endpoint = @endpoint`,
      { userId, endpoint },
    );
  },

  async deleteSubscriptionByEndpoint(endpoint) {
    await executeQuery(
      `DELETE FROM dbo.tblAssistantPushSubscription WHERE endpoint = @endpoint`,
      { endpoint },
    );
  },

  async dailySummary({ clientId, userId, companyId, branchId, finYearId }) {
    const result = await executeQuery(
      `EXEC dbo.assistantDailySummary
         @clientId = @clientId, @userId = @userId, @companyId = @companyId,
         @branchId = @branchId, @finYearId = @finYearId`,
      { clientId, userId, companyId, branchId, finYearId },
    );
    return (result.recordset || [])
      .map((row) => ({ label: String(row.label || "").trim(), value: Number(row.value) }))
      .filter((row) => row.label && Number.isFinite(row.value));
  },
};
