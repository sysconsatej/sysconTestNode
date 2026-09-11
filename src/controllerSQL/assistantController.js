// Artin assistant endpoints. Every route runs behind auth.verifyToken, and the
// user and client always come from the signed token, never from the body.
const model = require("../modelSQL/assistantModel");
const reminders = require("../services/assistantReminderService");

const KINDS = new Set(["note", "reminder", "timer", "memory"]);
const MAX_ITEMS_PER_SYNC = 200;

function ok(res, data, message = "OK") {
  return res.status(200).json({ success: true, message, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message, data: [] });
}

function identity(req) {
  const userId = Number(req.userId);
  const clientId = Number(req.clientId);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return { userId, clientId: Number.isFinite(clientId) ? clientId : 0 };
}

function epochMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function optionalInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanItem(raw) {
  const id = String(raw?.id ?? "").trim();
  const kind = String(raw?.kind ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(id) || !KINDS.has(kind)) return null;
  const now = Date.now();
  return {
    id,
    kind,
    text: String(raw?.text ?? "").slice(0, 1000),
    dueAt: kind === "reminder" || kind === "timer" ? epochMs(raw?.dueAt) : null,
    lang: String(raw?.lang ?? "").slice(0, 8) || null,
    createdAt: epochMs(raw?.createdAt) || now,
    updatedAt: epochMs(raw?.updatedAt) || now,
    deleted: raw?.deleted === true,
  };
}

module.exports = {
  listItems: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    try {
      return ok(res, await model.listItems(who.userId));
    } catch (error) {
      console.error("[Assistant] listItems", error.message);
      return fail(res, 500, "Could not load assistant items");
    }
  },

  syncItems: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .slice(0, MAX_ITEMS_PER_SYNC)
      .map(cleanItem)
      .filter(Boolean);
    try {
      await model.upsertItems(who, items);
      return ok(res, { saved: items.length });
    } catch (error) {
      console.error("[Assistant] syncItems", error.message);
      return fail(res, 500, "Could not save assistant items");
    }
  },

  pushConfig: (req, res) =>
    ok(res, { enabled: reminders.isPushEnabled(), publicKey: reminders.getPublicKey() }),

  subscribe: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    const endpoint = String(req.body?.subscription?.endpoint ?? "");
    const p256dh = String(req.body?.subscription?.keys?.p256dh ?? "");
    const auth = String(req.body?.subscription?.keys?.auth ?? "");
    if (
      !/^https:\/\/\S+$/.test(endpoint) ||
      endpoint.length > 800 ||
      !p256dh ||
      p256dh.length > 200 ||
      !auth ||
      auth.length > 100
    ) {
      return fail(res, 400, "Invalid push subscription");
    }
    try {
      await model.saveSubscription(
        who,
        { endpoint, p256dh, auth },
        String(req.headers["user-agent"] || "").slice(0, 300),
      );
      return ok(res, { subscribed: true });
    } catch (error) {
      console.error("[Assistant] subscribe", error.message);
      return fail(res, 500, "Could not save the push subscription");
    }
  },

  unsubscribe: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    const endpoint = String(req.body?.endpoint ?? "").slice(0, 800);
    if (!endpoint) return fail(res, 400, "Missing endpoint");
    try {
      await model.deleteSubscription(who.userId, endpoint);
      return ok(res, { subscribed: false });
    } catch (error) {
      console.error("[Assistant] unsubscribe", error.message);
      return fail(res, 500, "Could not remove the push subscription");
    }
  },

  summary: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    try {
      const rows = await model.dailySummary({
        clientId: who.clientId,
        userId: who.userId,
        companyId: optionalInt(req.body?.companyId),
        branchId: optionalInt(req.body?.branchId),
        finYearId: optionalInt(req.body?.finYearId),
      });
      return ok(res, rows.slice(0, 10));
    } catch (error) {
      // Most often the procedure has not been created yet.
      console.error("[Assistant] summary", error.message);
      return ok(res, []);
    }
  },
};
