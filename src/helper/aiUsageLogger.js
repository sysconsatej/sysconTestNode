const { connectToSql, sql } = require("../config/sqlConfig");

// Records one row per AI PDF extraction in dbo.tblAiExtractionUsage
// (create it with docs/sql/tblAiExtractionUsage.sql). Logging never throws and
// never delays the extraction; if the table does not exist yet, it warns once.
// Set AI_USAGE_LOG_ENABLED=false to switch it off.

// USD per 1M tokens (standard, non-batch). Thinking tokens bill as output.
const GEMINI_PRICING = {
  "gemini-2.5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
};

let missingTableWarned = false;

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function getPricing(model = "") {
  const name = String(model).toLowerCase();
  return name.includes("flash-lite")
    ? GEMINI_PRICING["gemini-2.5-flash-lite"]
    : GEMINI_PRICING["gemini-2.5-flash"];
}

function estimateCostUSD(usageMetadata = {}, model) {
  const pricing = getPricing(model);
  const input = Number(usageMetadata.promptTokenCount || 0);
  const output =
    Number(usageMetadata.candidatesTokenCount || 0) +
    Number(usageMetadata.thoughtsTokenCount || 0);

  return (
    (input / 1_000_000) * pricing.inputPer1M +
    (output / 1_000_000) * pricing.outputPer1M
  );
}

// entries: [{ usageMetadata, model }] from individual Gemini responses.
function summarizeGeminiUsage(entries = []) {
  const sum = (key) =>
    entries.reduce(
      (total, entry) => total + Number(entry?.usageMetadata?.[key] || 0),
      0,
    );

  return {
    promptTokenCount: sum("promptTokenCount"),
    candidatesTokenCount: sum("candidatesTokenCount"),
    thoughtsTokenCount: sum("thoughtsTokenCount"),
    totalTokenCount: sum("totalTokenCount"),
    modelsUsed: [...new Set(entries.map((e) => e?.model).filter(Boolean))],
    tokensAmount: {
      totalCostUSD: entries.reduce(
        (total, entry) =>
          total + estimateCostUSD(entry?.usageMetadata || {}, entry?.model),
        0,
      ),
    },
  };
}

async function insertUsageRow(row) {
  try {
    const pool = await connectToSql();

    await pool
      .request()
      .input("extractionId", sql.VarChar(64), row.extractionId)
      .input("documentType", sql.VarChar(30), row.documentType)
      .input("clientId", sql.Int, row.clientId)
      .input("userId", sql.Int, row.userId)
      .input("fileName", sql.NVarChar(500), row.fileName)
      .input("pageCount", sql.Int, row.pageCount)
      .input("status", sql.VarChar(20), row.status)
      .input("durationMs", sql.Int, row.durationMs)
      .input("models", sql.VarChar(200), row.models)
      .input("promptTokens", sql.Int, row.promptTokens)
      .input("outputTokens", sql.Int, row.outputTokens)
      .input("thoughtsTokens", sql.Int, row.thoughtsTokens)
      .input("totalTokens", sql.Int, row.totalTokens)
      .input("costUSD", sql.Decimal(12, 6), row.costUSD)
      .input("errorMessage", sql.NVarChar(1000), row.errorMessage).query(`
        INSERT INTO dbo.tblAiExtractionUsage
          (extractionId, documentType, clientId, userId, fileName, pageCount,
           status, durationMs, models, promptTokens, outputTokens,
           thoughtsTokens, totalTokens, costUSD, errorMessage)
        VALUES
          (@extractionId, @documentType, @clientId, @userId, @fileName,
           @pageCount, @status, @durationMs, @models, @promptTokens,
           @outputTokens, @thoughtsTokens, @totalTokens, @costUSD,
           @errorMessage)
      `);
  } catch (error) {
    // 208 = "Invalid object name": the table has not been created yet.
    if (error?.number === 208 || /Invalid object name/i.test(error?.message)) {
      if (!missingTableWarned) {
        missingTableWarned = true;
        console.warn(
          "[AI usage] dbo.tblAiExtractionUsage not found; extraction usage is " +
            "not being recorded. Create it with docs/sql/tblAiExtractionUsage.sql",
        );
      }
      return;
    }

    console.error("[AI usage] Failed to record extraction usage:", error?.message);
  }
}

// Call when a job starts; call finish() once when it ends. Later finish()
// calls are ignored, so a `finally` can safely record "cancelled" for runs
// that stopped without reaching completed/failed.
function startUsageLog({ documentType, extractionId, req, fileNames = [] }) {
  const startedAt = Date.now();
  let finished = false;

  return {
    finish({
      status,
      usage = null,
      pageCount = null,
      errorMessage = null,
      defaultModel = null,
    } = {}) {
      if (finished) return;
      finished = true;

      if (
        String(process.env.AI_USAGE_LOG_ENABLED ?? "true").toLowerCase() ===
        "false"
      ) {
        return;
      }

      const models = usage?.modelsUsed?.length
        ? usage.modelsUsed.join(",")
        : defaultModel;
      const outputTokens = usage
        ? Number(usage.candidatesTokenCount || 0) +
          Number(usage.thoughtsTokenCount || 0)
        : null;
      const costUSD = usage?.tokensAmount?.totalCostUSD;

      insertUsageRow({
        extractionId,
        documentType,
        clientId: toInt(req?.clientId),
        userId: toInt(req?.userId),
        fileName: fileNames.filter(Boolean).join(", ").slice(0, 500) || null,
        pageCount: toInt(pageCount),
        status,
        durationMs: Date.now() - startedAt,
        models: models ? String(models).slice(0, 200) : null,
        promptTokens: usage ? toInt(usage.promptTokenCount) : null,
        outputTokens,
        thoughtsTokens: usage ? toInt(usage.thoughtsTokenCount) : null,
        totalTokens: usage ? toInt(usage.totalTokenCount) : null,
        costUSD: Number.isFinite(Number(costUSD)) ? Number(costUSD) : null,
        errorMessage: errorMessage
          ? String(errorMessage).slice(0, 1000)
          : null,
      });
    },
  };
}

module.exports = {
  startUsageLog,
  summarizeGeminiUsage,
};
