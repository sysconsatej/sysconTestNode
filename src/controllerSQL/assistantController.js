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

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CONTEXT_NAMES = new Set(["clientId", "userId", "companyId", "branchId", "finYearId"]);

// Declared parameters of a catalog query. Names that could collide with the
// session values are dropped, so a caller can never override clientId.
function parseParameters(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map((parameter) => ({
        name: String(parameter?.name || ""),
        type: ["string", "number", "date"].includes(parameter?.type) ? parameter.type : "string",
        description: String(parameter?.description || "").slice(0, 160),
      }))
      .filter((parameter) => PARAMETER_NAME.test(parameter.name) && !CONTEXT_NAMES.has(parameter.name))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function coerceParameter(value, type) {
  if (value === undefined || value === null || value === "") return null;
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "date") {
    const text = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) ? text : null;
  }
  return String(value).slice(0, 200);
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

  // The catalog without procedure names: what each query answers and the
  // parameters it takes.
  queries: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    try {
      const rows = await model.listDataQueries(who.clientId);
      return ok(
        res,
        rows.map((row) => ({
          key: row.queryKey,
          title: row.title,
          description: row.description,
          parameters: parseParameters(row.parameters).map(({ name, type, description }) => ({
            name,
            type,
            description,
          })),
        })),
      );
    } catch (error) {
      // Most often the catalog table has not been created yet.
      console.error("[Assistant] queries", error.message);
      return ok(res, []);
    }
  },

  query: async (req, res) => {
    const who = identity(req);
    if (!who) return fail(res, 401, "Unauthorized");
    const key = String(req.body?.key ?? "").trim();
    try {
      const entry = (await model.listDataQueries(who.clientId)).find(
        (row) => row.queryKey === key,
      );
      if (!entry) return fail(res, 404, "Unknown query");
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(entry.procedureName)) {
        return fail(res, 500, "The query is misconfigured");
      }

      const inputs = {};
      const supplied = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};
      parseParameters(entry.parameters).forEach((parameter) => {
        inputs[parameter.name] = coerceParameter(supplied[parameter.name], parameter.type);
      });
      const session = {
        clientId: who.clientId,
        userId: who.userId,
        companyId: optionalInt(req.body?.companyId),
        branchId: optionalInt(req.body?.branchId),
        finYearId: optionalInt(req.body?.finYearId),
      };
      String(entry.contextParameters || "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => Object.prototype.hasOwnProperty.call(session, name))
        .forEach((name) => {
          inputs[name] = session[name];
        });

      const rows = (await model.runDataQuery(entry.procedureName, inputs)).slice(0, 200);
      return ok(res, {
        title: entry.title,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows,
      });
    } catch (error) {
      console.error("[Assistant] query", key, error.message);
      return fail(res, 500, "Could not run the query");
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
