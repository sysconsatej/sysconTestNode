const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");
const { GoogleGenAI, createPartFromUri } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const GEMINI_MODELS = String(
  process.env.GEMINI_MODELS ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash,gemini-2.5-flash-lite",
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const GEMINI_FILE_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_POLL_INTERVAL_MS || 2000,
);

const GEMINI_FILE_PROCESSING_TIMEOUT_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_TIMEOUT_MS || 15 * 60 * 1000,
);

const GEMINI_GENERATE_RETRIES = Number(
  process.env.GEMINI_GENERATE_RETRIES || 4,
);

const GEMINI_RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS || 3000);

let readingStatus = {
  status: "idle",
  stage: "idle",
  progress: 0,
  message: "No active process",
  currentFileIndex: null,
  totalFiles: 0,
  currentFileName: null,
  data: null,
  error: null,
  updatedAt: new Date().toISOString(),
};

function setReadingStatus(patch = {}) {
  readingStatus = {
    ...readingStatus,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function resetReadingStatus() {
  readingStatus = {
    status: "idle",
    stage: "idle",
    progress: 0,
    message: "No active process",
    currentFileIndex: null,
    totalFiles: 0,
    currentFileName: null,
    data: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeErrorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error?.message) return String(error.message);

  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

function getReadableGeminiError(error) {
  const text = safeErrorText(error);
  const lower = text.toLowerCase();

  if (
    lower.includes("high demand") ||
    lower.includes("unavailable") ||
    lower.includes("503")
  ) {
    return "AI PDF reader is temporarily busy. Please try again after some time.";
  }

  if (lower.includes("resource exhausted") || lower.includes("429")) {
    return "AI PDF reader limit is temporarily reached. Please try again after some time.";
  }

  return text || "Gemini PDF extraction failed";
}

function isRetryableGeminiError(error) {
  const message = safeErrorText(error).toLowerCase();

  return [
    "503",
    "unavailable",
    "high demand",
    "overloaded",
    "temporarily unavailable",
    "resource exhausted",
    "429",
    "500",
    "internal error",
    "deadline exceeded",
    "timeout",
    "timed out",
    "fetch failed",
    "socket hang up",
    "econnreset",
    "etimedout",
    "network",
  ].some((token) => message.includes(token));
}

async function withGeminiRetry(fn, options = {}) {
  const {
    retries = GEMINI_GENERATE_RETRIES,
    baseDelayMs = GEMINI_RETRY_BASE_MS,
    label = "Gemini request",
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const canRetry = isRetryableGeminiError(error);

      if (!canRetry || attempt > retries) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      if (typeof onRetry === "function") {
        onRetry(error, attempt, delayMs, label);
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function generateContentWithModelFallback({
  contents,
  config,
  label = "Gemini extraction",
  onStatus,
}) {
  let lastError;

  for (const model of GEMINI_MODELS) {
    try {
      if (typeof onStatus === "function") {
        onStatus({
          model,
          attempt: 1,
          message: `Trying Gemini model: ${model}`,
        });
      }

      return await withGeminiRetry(
        async (attempt) => {
          if (typeof onStatus === "function") {
            onStatus({
              model,
              attempt,
              message:
                attempt === 1
                  ? `Extracting with ${model}`
                  : `Retrying ${model}, attempt ${attempt}`,
            });
          }

          return await ai.models.generateContent({
            model,
            contents,
            config,
          });
        },
        {
          label: `${label} using ${model}`,
          onRetry: (error, attempt, delayMs) => {
            console.error(
              `${label} retry ${attempt} failed for ${model}. Retrying after ${delayMs}ms`,
              safeErrorText(error),
            );
          },
        },
      );
    } catch (error) {
      lastError = error;

      console.error(
        `${label} failed for model ${model}:`,
        safeErrorText(error),
      );

      if (typeof onStatus === "function") {
        onStatus({
          model,
          attempt: null,
          message: `${model} failed. Trying next fallback model if available.`,
        });
      }
    }
  }

  throw lastError;
}

function isMeaningfulValue(v) {
  return !(
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "")
  );
}

function normalizeWhitespace(value) {
  if (!isMeaningfulValue(value)) return null;

  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLabelToken(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLines(rawText = "") {
  return String(rawText || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function firstNonEmptyMatch(text = "", regexes = []) {
  for (const regex of regexes) {
    const match = text.match(regex);
    const value = normalizeWhitespace(match?.[1] || null);
    if (value) return value;
  }

  return null;
}

function normalizeMoney(value) {
  if (!isMeaningfulValue(value)) return null;

  const raw = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .trim();

  if (!raw || /^[-–—]+$/.test(raw)) return null;

  const isNegative = /^\(.+\)$/.test(raw);
  const cleaned = raw.replace(/[()]/g, "").replace(/[^0-9.\-]/g, "");
  const num = Number(cleaned);

  if (!Number.isFinite(num)) return null;

  const signed = isNegative ? -Math.abs(num) : num;
  return Number(signed.toFixed(2));
}

function round2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();

    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function dedupeObjectArray(arr = []) {
  const seen = new Set();
  const out = [];

  for (const item of arr || []) {
    const key = stableStringify(item);

    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function normalizeDeductorRow(row = {}) {
  const srNoRaw = row.srNo ?? row.srNoDeductor ?? row["Sr. No."];
  const srNo = Number.parseInt(String(srNoRaw || "").trim(), 10);

  return {
    srNo: Number.isFinite(srNo) ? srNo : null,
    nameOfDeductor:
      normalizeWhitespace(
        row.nameOfDeductor ?? row.name ?? row["Name of Deductor"],
      ) || null,
    tanOfDeductor:
      normalizeWhitespace(
        row.tanOfDeductor ?? row.tan ?? row["TAN of Deductor"],
      ) || null,
    totalAmountPaidCredited: normalizeMoney(
      row.totalAmountPaidCredited ??
        row.totalAmountPaid ??
        row["Total Amount Paid / Credited"],
    ),
    totalTaxDeducted: normalizeMoney(
      row.totalTaxDeducted ?? row.taxDeducted ?? row["Total Tax Deducted"],
    ),
    totalTdsDeposited: normalizeMoney(
      row.totalTdsDeposited ?? row.tdsDeposited ?? row["Total TDS Deposited"],
    ),
  };
}

function isValidDeductorRow(row = {}) {
  if (!row) return false;
  if (!Number.isFinite(Number(row.srNo))) return false;
  if (!row.nameOfDeductor) return false;

  if (!/^[A-Z]{3,5}[0-9]{4,6}[A-Z]$/i.test(String(row.tanOfDeductor || ""))) {
    return false;
  }

  return (
    row.totalAmountPaidCredited !== null ||
    row.totalTaxDeducted !== null ||
    row.totalTdsDeposited !== null
  );
}

function buildDeductorSummary(rows = []) {
  return {
    rowCount: rows.length,
    amountPaidCreditedTotal: round2(
      rows.reduce(
        (sum, row) => sum + Number(row.totalAmountPaidCredited || 0),
        0,
      ),
    ),
    taxDeductedTotal: round2(
      rows.reduce((sum, row) => sum + Number(row.totalTaxDeducted || 0), 0),
    ),
    tdsDepositedTotal: round2(
      rows.reduce((sum, row) => sum + Number(row.totalTdsDeposited || 0), 0),
    ),
  };
}

function normalizeForm26ASResult(data = {}) {
  const partI = dedupeObjectArray(
    (Array.isArray(data.form26ASTdsPartI) ? data.form26ASTdsPartI : [])
      .map(normalizeDeductorRow)
      .filter(isValidDeductorRow),
  ).sort((a, b) => Number(a.srNo || 0) - Number(b.srNo || 0));

  const partII = dedupeObjectArray(
    (Array.isArray(data.form26ASTdsPartII) ? data.form26ASTdsPartII : [])
      .map(normalizeDeductorRow)
      .filter(isValidDeductorRow),
  ).sort((a, b) => Number(a.srNo || 0) - Number(b.srNo || 0));

  const partISummary = buildDeductorSummary(partI);
  const partIISummary = buildDeductorSummary(partII);

  const partIIStatus =
    normalizeWhitespace(data.form26ASSummary?.partIIStatus) ||
    (partII.length ? "Transactions Present" : "No Transactions Present");

  return {
    pdfType: data.pdfType || "FORM_26AS_ANNUAL_TAX_STATEMENT",
    form26ASInfo: {
      pan: normalizeWhitespace(data.form26ASInfo?.pan ?? data.pan) || null,
      currentStatusOfPAN:
        normalizeWhitespace(
          data.form26ASInfo?.currentStatusOfPAN ?? data.currentStatusOfPAN,
        ) || null,
      financialYear:
        normalizeWhitespace(
          data.form26ASInfo?.financialYear ?? data.financialYear,
        ) || null,
      assessmentYear:
        normalizeWhitespace(
          data.form26ASInfo?.assessmentYear ?? data.assessmentYear,
        ) || null,
      nameOfAssessee:
        normalizeWhitespace(
          data.form26ASInfo?.nameOfAssessee ?? data.nameOfAssessee,
        ) || null,
      addressOfAssessee:
        normalizeWhitespace(
          data.form26ASInfo?.addressOfAssessee ?? data.addressOfAssessee,
        ) || null,
      dataUpdatedTill:
        normalizeWhitespace(
          data.form26ASInfo?.dataUpdatedTill ?? data.dataUpdatedTill,
        ) || null,
    },
    form26ASTdsPartI: partI,
    form26ASTdsPartII: partII,
    form26ASSummary: {
      partIRowCount: partISummary.rowCount,
      partIAmountPaidCreditedTotal: partISummary.amountPaidCreditedTotal,
      partITaxDeductedTotal: partISummary.taxDeductedTotal,
      partITdsDepositedTotal: partISummary.tdsDepositedTotal,

      partIIRowCount: partIISummary.rowCount,
      partIIAmountPaidCreditedTotal: partIISummary.amountPaidCreditedTotal,
      partIITaxDeductedTotal: partIISummary.taxDeductedTotal,
      partIITdsDepositedTotal: partIISummary.tdsDepositedTotal,

      partIIStatus,
    },
  };
}

function hasUsefulForm26ASExtraction(result = {}) {
  return (
    Number(result?.form26ASSummary?.partIRowCount || 0) > 0 ||
    Number(result?.form26ASSummary?.partIIRowCount || 0) > 0 ||
    !!result?.form26ASInfo?.pan ||
    !!result?.pan
  );
}

function toFlatForm32ASData(
  data = {},
  pdfFilesArg = null,
  processingInfoArg = null,
) {
  if (!data || typeof data !== "object") return data;

  const info = data.form26ASInfo || {};
  const summary = data.form26ASSummary || {};

  const pdfFiles = Array.isArray(pdfFilesArg)
    ? pdfFilesArg
    : Array.isArray(data.pdfFiles)
      ? data.pdfFiles
      : [];

  const processingInfo =
    processingInfoArg && typeof processingInfoArg === "object"
      ? processingInfoArg
      : data.processingInfo && typeof data.processingInfo === "object"
        ? data.processingInfo
        : {};

  return {
    pdfType: data.pdfType || "FORM_26AS_ANNUAL_TAX_STATEMENT",

    pan: info.pan || data.pan || null,
    currentStatusOfPAN:
      info.currentStatusOfPAN || data.currentStatusOfPAN || null,
    financialYear: info.financialYear || data.financialYear || null,
    assessmentYear: info.assessmentYear || data.assessmentYear || null,
    nameOfAssessee: info.nameOfAssessee || data.nameOfAssessee || null,
    addressOfAssessee: info.addressOfAssessee || data.addressOfAssessee || null,
    dataUpdatedTill: info.dataUpdatedTill || data.dataUpdatedTill || null,

    form26ASTdsPartI: Array.isArray(data.form26ASTdsPartI)
      ? data.form26ASTdsPartI
      : [],

    partIRowCount: Number(summary.partIRowCount || data.partIRowCount || 0),
    partIAmountPaidCreditedTotal: Number(
      summary.partIAmountPaidCreditedTotal ||
        data.partIAmountPaidCreditedTotal ||
        0,
    ),
    partITaxDeductedTotal: Number(
      summary.partITaxDeductedTotal || data.partITaxDeductedTotal || 0,
    ),
    partITdsDepositedTotal: Number(
      summary.partITdsDepositedTotal || data.partITdsDepositedTotal || 0,
    ),

    partIIRowCount: Number(summary.partIIRowCount || data.partIIRowCount || 0),
    partIIAmountPaidCreditedTotal: Number(
      summary.partIIAmountPaidCreditedTotal ||
        data.partIIAmountPaidCreditedTotal ||
        0,
    ),
    partIITaxDeductedTotal: Number(
      summary.partIITaxDeductedTotal || data.partIITaxDeductedTotal || 0,
    ),
    partIITdsDepositedTotal: Number(
      summary.partIITdsDepositedTotal || data.partIITdsDepositedTotal || 0,
    ),

    partIIStatus:
      summary.partIIStatus ||
      data.partIIStatus ||
      (Number(summary.partIIRowCount || data.partIIRowCount || 0) > 0
        ? "Transactions Present"
        : "No Transactions Present"),

    pdfFiles,
    processingInfo,
  };
}

function looksLikeForm26AS(rawText = "") {
  const t = normalizeLabelToken(rawText);

  return (
    t.includes("ANNUAL TAX STATEMENT") ||
    t.includes("PART I DETAILS OF TAX DEDUCTED AT SOURCE") ||
    t.includes(
      "PART I DETAILS OF TAX DEDUCTED AT SOURCE ALL AMOUNT VALUES ARE IN INR",
    ) ||
    t.includes("PERMANENT ACCOUNT NUMBER PAN") ||
    t.includes("FORM 26AS") ||
    t.includes("TRACES") ||
    t.includes("TDS RECONCILIATION ANALYSIS")
  );
}

function getSectionText(rawText = "", startMarkers = [], endMarkers = []) {
  const text = String(rawText || "");
  const upper = text.toUpperCase();

  let start = -1;

  for (const marker of startMarkers) {
    const idx = upper.indexOf(String(marker || "").toUpperCase());

    if (idx !== -1 && (start === -1 || idx < start)) {
      start = idx;
    }
  }

  if (start === -1) return "";

  let end = text.length;

  for (const marker of endMarkers) {
    const idx = upper.indexOf(String(marker || "").toUpperCase(), start + 1);

    if (idx !== -1 && idx < end) {
      end = idx;
    }
  }

  return text.slice(start, end);
}

function extractForm26ASInfo(rawText = "") {
  const text = String(rawText || "");
  const lines = getLines(text);

  const pan = firstNonEmptyMatch(text, [
    /Permanent\s+Account\s+Number\s*\(PAN\)\s*([A-Z]{5}[0-9]{4}[A-Z])/i,
    /\bPAN\b\s*[:\-]?\s*([A-Z]{5}[0-9]{4}[A-Z])/i,
  ]);

  const currentStatusOfPAN = firstNonEmptyMatch(text, [
    /Current\s+Status\s+of\s+PAN\s*([A-Za-z ]+?)(?:\s+Financial\s+Year|\n|$)/i,
  ]);

  let financialYear = firstNonEmptyMatch(text, [
    /Financial\s+Year\s*([0-9]{4}\s*-\s*[0-9]{2})/i,
    /([0-9]{4}\s*-\s*[0-9]{2})\s+Assessment\s+Year/i,
  ]);

  if (financialYear) {
    financialYear = financialYear.replace(/\s+/g, "");
  }

  let assessmentYear = firstNonEmptyMatch(text, [
    /Assessment\s+Year\s*([0-9]{4}\s*-\s*[0-9]{2})/i,
  ]);

  if (assessmentYear) {
    assessmentYear = assessmentYear.replace(/\s+/g, "");
  }

  const nameOfAssessee = firstNonEmptyMatch(text, [
    /Name\s+of\s+Assessee\s+(.+?)(?:\s+Permanent\s+Account\s+Number|\n|$)/i,
  ]);

  const dataUpdatedTill = firstNonEmptyMatch(text, [
    /Data\s+updated\s+till\s+([0-9]{1,2}[-/][A-Za-z]{3}[-/][0-9]{4})/i,
    /Data\s+updated\s+till\s+([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{4})/i,
  ]);

  let addressOfAssessee = null;

  const addressIdx = lines.findIndex((line) =>
    normalizeLabelToken(line).startsWith("ADDRESS OF ASSESSEE"),
  );

  if (addressIdx !== -1) {
    const buffer = [];

    for (let i = addressIdx + 1; i < lines.length; i++) {
      const n = normalizeLabelToken(lines[i]);

      if (
        n.startsWith("ABOVE DATA") ||
        n.startsWith("PLEASE NOTE") ||
        n.includes("ANNUAL TAX STATEMENT") ||
        n.includes("ASSESSMENT YEAR") ||
        n.includes("PART I DETAILS")
      ) {
        break;
      }

      buffer.push(lines[i]);
    }

    addressOfAssessee = normalizeWhitespace(buffer.join(" "));
  }

  return {
    pan,
    currentStatusOfPAN,
    financialYear,
    assessmentYear,
    nameOfAssessee,
    addressOfAssessee,
    dataUpdatedTill,
  };
}

function parse26ASDeductorRowsFromSection(sectionText = "") {
  const rows = [];

  const text = String(sectionText || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n");

  const lineRows = getLines(text);

  const directRowRegex =
    /^\s*(\d{1,5})\s+(.+?)\s+([A-Z]{3,5}[0-9]{4,6}[A-Z])\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i;

  const twoAmountRowRegex =
    /^\s*(\d{1,5})\s+(.+?)\s+([A-Z]{3,5}[0-9]{4,6}[A-Z])\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i;

  for (const line of lineRows) {
    const normalizedLine = normalizeWhitespace(line);
    if (!normalizedLine) continue;

    const upper = normalizeLabelToken(normalizedLine);

    if (
      upper.includes("SECTION") ||
      upper.includes("TRANSACTION DATE") ||
      upper.includes("STATUS OF BOOKING") ||
      upper.includes("DATE OF BOOKING") ||
      upper.includes("REMARKS")
    ) {
      continue;
    }

    let match = normalizedLine.match(directRowRegex);

    if (match) {
      const row = normalizeDeductorRow({
        srNo: match[1],
        nameOfDeductor: match[2],
        tanOfDeductor: match[3],
        totalAmountPaidCredited: match[4],
        totalTaxDeducted: match[5],
        totalTdsDeposited: match[6],
      });

      if (isValidDeductorRow(row)) rows.push(row);
      continue;
    }

    match = normalizedLine.match(twoAmountRowRegex);

    if (match) {
      const row = normalizeDeductorRow({
        srNo: match[1],
        nameOfDeductor: match[2],
        tanOfDeductor: match[3],
        totalAmountPaidCredited: match[4],
        totalTaxDeducted: match[5],
        totalTdsDeposited: match[5],
      });

      if (isValidDeductorRow(row)) rows.push(row);
    }
  }

  if (rows.length) {
    return dedupeObjectArray(rows).sort(
      (a, b) => Number(a.srNo || 0) - Number(b.srNo || 0),
    );
  }

  const compact = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

  const fallbackRegex =
    /(?:^|\s)(\d{1,5})\s+([A-Z0-9&.,'()\/\- ]{2,180}?)\s+([A-Z]{3,5}[0-9]{4,6}[A-Z])\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?)(?:\s+([-()]?[0-9][0-9,]*(?:\.[0-9]+)?))?/gi;

  let match;

  while ((match = fallbackRegex.exec(compact)) !== null) {
    const row = normalizeDeductorRow({
      srNo: match[1],
      nameOfDeductor: match[2],
      tanOfDeductor: match[3],
      totalAmountPaidCredited: match[4],
      totalTaxDeducted: match[5],
      totalTdsDeposited: match[6] || match[5],
    });

    if (isValidDeductorRow(row)) {
      rows.push(row);
    }
  }

  return dedupeObjectArray(rows).sort(
    (a, b) => Number(a.srNo || 0) - Number(b.srNo || 0),
  );
}

function extractPartIIStatus(partIISection = "") {
  const n = normalizeLabelToken(partIISection);

  if (
    n.includes("NO TRANSACTION PRESENT") ||
    n.includes("NO TRANSACTIONS PRESENT")
  ) {
    return "No Transactions Present";
  }

  return null;
}

function extractForm26ASFromText(rawText = "") {
  const text = String(rawText || "");

  const partISection = getSectionText(
    text,
    [
      "PART-I - Details of Tax Deducted at Source",
      "PART-I- Details of Tax Deducted at Source",
      "PART I - Details of Tax Deducted at Source",
      "PART I Details of Tax Deducted at Source",
    ],
    [
      "PART-II-Details of Tax Deducted at Source for 15G / 15H",
      "PART-II - Details of Tax Deducted at Source for 15G / 15H",
      "PART II-Details of Tax Deducted at Source for 15G / 15H",
      "PART II - Details of Tax Deducted at Source for 15G / 15H",
      "PART-III",
      "PART III",
    ],
  );

  const partIISection = getSectionText(
    text,
    [
      "PART-II-Details of Tax Deducted at Source for 15G / 15H",
      "PART-II - Details of Tax Deducted at Source for 15G / 15H",
      "PART II-Details of Tax Deducted at Source for 15G / 15H",
      "PART II - Details of Tax Deducted at Source for 15G / 15H",
    ],
    [
      "PART-III",
      "PART III",
      "PART-IV",
      "PART IV",
      "PART-V",
      "PART V",
      "PART-VI",
      "PART VI",
      "PART-VII",
      "PART VII",
    ],
  );

  let partIRows = parse26ASDeductorRowsFromSection(partISection);
  const partIIRows = parse26ASDeductorRowsFromSection(partIISection);

  if (!partIRows.length) {
    partIRows = parse26ASDeductorRowsFromSection(text);
  }

  return normalizeForm26ASResult({
    pdfType: "FORM_26AS_ANNUAL_TAX_STATEMENT",
    form26ASInfo: extractForm26ASInfo(text),
    form26ASTdsPartI: partIRows,
    form26ASTdsPartII: partIIRows,
    form26ASSummary: {
      partIIStatus: extractPartIIStatus(partIISection),
    },
  });
}

async function loadPdfJs() {
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (_) {
    try {
      return await import("pdfjs-dist/build/pdf.mjs");
    } catch (error) {
      console.error(
        "pdfjs-dist not available. Install using: npm i pdfjs-dist",
        safeErrorText(error),
      );
      return null;
    }
  }
}

function groupPdfJsItemsIntoLines(items = []) {
  const rows = [];
  const yTolerance = 2.5;

  for (const item of items) {
    const text = normalizeWhitespace(item?.str);
    if (!text) continue;

    const transform = item.transform || [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);

    let row = rows.find((r) => Math.abs(r.y - y) <= yTolerance);

    if (!row) {
      row = {
        y,
        items: [],
      };
      rows.push(row);
    }

    row.items.push({
      x,
      text,
    });

    row.y = (row.y + y) / 2;
  }

  rows.sort((a, b) => b.y - a.y);

  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      return row.items.map((item) => item.text).join(" ");
    })
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

async function extractTextFromPdfBufferByPdfJs(buffer) {
  try {
    const pdfjsLib = await loadPdfJs();
    if (!pdfjsLib) return "";

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useSystemFonts: true,
      isEvalSupported: false,
    });

    const pdf = await loadingTask.promise;
    const allPageTexts = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
      });

      const lines = groupPdfJsItemsIntoLines(textContent.items || []);
      allPageTexts.push(`\n--- PAGE ${pageNo} ---\n${lines.join("\n")}`);
    }

    try {
      await pdf.destroy();
    } catch (_) {}

    return normalizeWhitespace(allPageTexts.join("\n")) || "";
  } catch (error) {
    console.error(
      "extractTextFromPdfBufferByPdfJs failed:",
      safeErrorText(error),
    );
    return "";
  }
}

function mergeTextBlocks(blocks = []) {
  return blocks
    .map((x) => normalizeWhitespace(x))
    .filter(Boolean)
    .join("\n\n");
}

function mergeForm26ASResults(results = []) {
  const info = {};
  const partI = [];
  const partII = [];
  let partIIStatus = null;

  for (const item of results || []) {
    if (!item) continue;

    const currentInfo = item.form26ASInfo || {};

    for (const [key, value] of Object.entries(currentInfo)) {
      if (!isMeaningfulValue(info[key]) && isMeaningfulValue(value)) {
        info[key] = value;
      }
    }

    if (Array.isArray(item.form26ASTdsPartI)) {
      partI.push(...item.form26ASTdsPartI);
    }

    if (Array.isArray(item.form26ASTdsPartII)) {
      partII.push(...item.form26ASTdsPartII);
    }

    if (!partIIStatus && item.form26ASSummary?.partIIStatus) {
      partIIStatus = item.form26ASSummary.partIIStatus;
    }
  }

  return normalizeForm26ASResult({
    pdfType: "FORM_26AS_ANNUAL_TAX_STATEMENT",
    form26ASInfo: info,
    form26ASTdsPartI: partI,
    form26ASTdsPartII: partII,
    form26ASSummary: {
      partIIStatus,
    },
  });
}

async function extractForm26ASUsingDeterministicParsers(buffer, fileName) {
  const parserResults = [];
  const parserUsed = [];

  const pdfParseText = await extractTextFromPdfBuffer(buffer);

  if (pdfParseText && pdfParseText.trim()) {
    const parsed = extractForm26ASFromText(pdfParseText);
    parserResults.push(parsed);
    parserUsed.push("pdf-parse");

    console.log(
      `pdf-parse rows for ${fileName}:`,
      parsed.form26ASSummary?.partIRowCount,
    );
  }

  const pdfJsText = await extractTextFromPdfBufferByPdfJs(buffer);

  if (pdfJsText && pdfJsText.trim()) {
    const parsed = extractForm26ASFromText(pdfJsText);
    parserResults.push(parsed);
    parserUsed.push("pdfjs-dist-positional");

    console.log(
      `pdfjs-dist rows for ${fileName}:`,
      parsed.form26ASSummary?.partIRowCount,
    );
  }

  const mergedText = mergeTextBlocks([pdfParseText, pdfJsText]);

  if (mergedText && mergedText.trim()) {
    const parsed = extractForm26ASFromText(mergedText);
    parserResults.push(parsed);
    parserUsed.push("merged-text");
  }

  const finalResult = mergeForm26ASResults(parserResults);

  return {
    result: finalResult,
    parserUsed: parserUsed.join(" + ") || null,
    rawTextFound: !!mergedText,
    looksLikeForm26AS: looksLikeForm26AS(mergedText),
  };
}

const S = {
  str: (description) => ({
    type: ["string", "null"],
    description,
  }),
  num: (description) => ({
    type: ["number", "null"],
    description,
  }),
};

const FORM26AS_DEDUCTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    srNo: S.num("Sr. No. from Form 26AS grid."),
    nameOfDeductor: S.str("Name of Deductor."),
    tanOfDeductor: S.str("TAN of Deductor."),
    totalAmountPaidCredited: S.num("Total Amount Paid / Credited."),
    totalTaxDeducted: S.num("Total Tax Deducted."),
    totalTdsDeposited: S.num("Total TDS Deposited."),
  },
  required: [],
};

const FORM26AS_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pdfType: S.str("FORM_26AS_ANNUAL_TAX_STATEMENT"),
    form26ASInfo: {
      type: "object",
      additionalProperties: false,
      properties: {
        pan: S.str("Permanent Account Number PAN."),
        currentStatusOfPAN: S.str("Current Status of PAN."),
        financialYear: S.str("Financial Year."),
        assessmentYear: S.str("Assessment Year."),
        nameOfAssessee: S.str("Name of Assessee."),
        addressOfAssessee: S.str("Address of Assessee."),
        dataUpdatedTill: S.str("Data updated till date."),
      },
      required: [],
    },
    form26ASTdsPartI: {
      type: "array",
      items: FORM26AS_DEDUCTOR_SCHEMA,
    },
    form26ASTdsPartII: {
      type: "array",
      items: FORM26AS_DEDUCTOR_SCHEMA,
    },
    form26ASSummary: {
      type: "object",
      additionalProperties: false,
      properties: {
        partIIStatus: S.str(
          "No Transactions Present / Transactions Present / null.",
        ),
      },
      required: [],
    },
  },
  required: [],
};

function buildGeminiForm26ASPrompt(fileName = "") {
  return `
You are a high accuracy Indian Form 26AS / Form32AS PDF extraction engine.

Return ONLY valid JSON matching the schema.

Extract this PDF type:
Annual Tax Statement / Form 26AS / Form32AS.

Important:
- Extract only grid data from these sections:
  1. PART-I - Details of Tax Deducted at Source
  2. PART-II-Details of Tax Deducted at Source for 15G / 15H
- For PART-I and PART-II rows, extract:
  srNo
  nameOfDeductor
  tanOfDeductor
  totalAmountPaidCredited
  totalTaxDeducted
  totalTdsDeposited

Rules:
- Do not extract transaction sub-table rows.
- Do not extract Section / Transaction Date / Date of Booking rows.
- Do not duplicate rows.
- If PART-II says No Transactions Present, return form26ASTdsPartII as [] and form26ASSummary.partIIStatus as "No Transactions Present".
- Amounts must be numbers only.
- If a field is missing, return null.
- Do not guess values.

File name:
${fileName}
`;
}

function safeFileState(state) {
  if (!state) return "UNKNOWN";

  if (typeof state === "string") {
    return state.toUpperCase();
  }

  if (typeof state === "object" && state.name) {
    return String(state.name).toUpperCase();
  }

  return String(state).toUpperCase();
}

async function uploadGeminiFileWithRetry(tempPath, fileName) {
  return await withGeminiRetry(
    async () => {
      return await ai.files.upload({
        file: tempPath,
        config: {
          mimeType: "application/pdf",
          displayName: fileName || "form26as.pdf",
        },
      });
    },
    {
      label: `Gemini file upload for ${fileName}`,
      onRetry: (error, attempt, delayMs) => {
        console.error(
          `Gemini upload retry ${attempt} for ${fileName}. Waiting ${delayMs}ms`,
          safeErrorText(error),
        );
      },
    },
  );
}

async function getGeminiFileWithRetry(uploadedName, fileName) {
  return await withGeminiRetry(
    async () => {
      return await ai.files.get({
        name: uploadedName,
      });
    },
    {
      label: `Gemini file get for ${fileName}`,
      onRetry: (error, attempt, delayMs) => {
        console.error(
          `Gemini file get retry ${attempt} for ${fileName}. Waiting ${delayMs}ms`,
          safeErrorText(error),
        );
      },
    },
  );
}

async function extractForm26ASUsingGemini(
  buffer,
  fileName,
  statusContext = {},
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "PDF text could not be read and GEMINI_API_KEY is not configured for OCR fallback.",
    );
  }

  const tempPath = path.join(
    os.tmpdir(),
    `${Date.now()}-${crypto.randomUUID()}-${fileName || "form26as.pdf"}`,
  );

  let uploadedName = null;

  try {
    await fs.writeFile(tempPath, buffer);

    const uploaded = await uploadGeminiFileWithRetry(tempPath, fileName);
    uploadedName = uploaded.name;

    const startedAt = Date.now();

    let fetchedFile = await getGeminiFileWithRetry(uploaded.name, fileName);

    while (safeFileState(fetchedFile.state) === "PROCESSING") {
      if (Date.now() - startedAt > GEMINI_FILE_PROCESSING_TIMEOUT_MS) {
        throw new Error(`Gemini file processing timed out for ${fileName}`);
      }

      setReadingStatus({
        status: "running",
        stage: "ocr_fallback_processing",
        currentFileIndex: statusContext.currentFileIndex || null,
        totalFiles: statusContext.totalFiles || null,
        currentFileName: fileName,
        message: `Gemini is processing ${fileName}`,
        error: null,
      });

      await sleep(GEMINI_FILE_POLL_INTERVAL_MS);
      fetchedFile = await getGeminiFileWithRetry(uploaded.name, fileName);
    }

    if (safeFileState(fetchedFile.state) === "FAILED") {
      throw new Error(`Gemini failed to process file: ${fileName}`);
    }

    const response = await generateContentWithModelFallback({
      label: `Form26AS extraction for ${fileName}`,
      contents: [
        buildGeminiForm26ASPrompt(fileName),
        createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
      ],
      config: {
        temperature: 0,
        systemInstruction:
          "You are a strict JSON extraction engine. Return only JSON. Prefer null over guessing.",
        responseMimeType: "application/json",
        responseJsonSchema: FORM26AS_EXTRACTION_SCHEMA,
      },
      onStatus: ({ model, attempt, message }) => {
        setReadingStatus({
          status: "running",
          stage: "ocr_fallback",
          currentFileIndex: statusContext.currentFileIndex || null,
          totalFiles: statusContext.totalFiles || null,
          currentFileName: fileName,
          message:
            message ||
            `Using Gemini model ${model}${attempt ? ` attempt ${attempt}` : ""}`,
          error: null,
        });
      },
    });

    let parsed;

    try {
      parsed = JSON.parse(response.text);
    } catch (error) {
      console.error("Gemini raw Form26AS response:", response.text);
      throw new Error(`Gemini returned invalid JSON for ${fileName}`);
    }

    return normalizeForm26ASResult(parsed);
  } catch (error) {
    throw new Error(getReadableGeminiError(error));
  } finally {
    try {
      await fs.unlink(tempPath);
    } catch (_) {}

    if (uploadedName) {
      try {
        await ai.files.delete({
          name: uploadedName,
        });
      } catch (_) {}
    }
  }
}

function isPdfFile(file) {
  const mime = String(file?.mimetype || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();

  if (mime === "application/pdf") return true;
  if (mime === "application/octet-stream" && name.endsWith(".pdf")) return true;
  if (!mime && name.endsWith(".pdf")) return true;

  return false;
}

function getUploadedFiles(req) {
  if (!req.files || typeof req.files !== "object") return [];

  const files = [];

  for (const value of Object.values(req.files)) {
    if (Array.isArray(value)) {
      files.push(...value);
    } else if (value) {
      files.push(value);
    }
  }

  return files;
}

async function getFileBuffer(file) {
  if (file?.data && Buffer.isBuffer(file.data)) {
    return file.data;
  }

  if (file?.tempFilePath) {
    return await fs.readFile(file.tempFilePath);
  }

  return null;
}

async function extractTextFromPdfBuffer(buffer) {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) return "";

    const parsed = await pdfParse(buffer);
    return String(parsed?.text || "");
  } catch (error) {
    console.error("extractTextFromPdfBuffer failed:", safeErrorText(error));
    return "";
  }
}

module.exports = {
  extractForm32AsPdfData: async (req, res) => {
    try {
      if (readingStatus.status === "running") {
        return res.status(409).json({
          success: false,
          error: "Another PDF extraction is already running",
          readingStatus: {
            ...readingStatus,
            data: readingStatus.data
              ? toFlatForm32ASData(readingStatus.data)
              : readingStatus.data,
          },
        });
      }

      const files = getUploadedFiles(req);

      if (!files.length) {
        return res.status(400).json({
          success: false,
          error:
            "No PDF files received. Send file(s) in form-data using key 'file'.",
        });
      }

      const invalidFile = files.find((f) => !isPdfFile(f));

      if (invalidFile) {
        return res.status(400).json({
          success: false,
          error: `Only PDF files are allowed. Invalid file: ${
            invalidFile.name || "unknown"
          }`,
        });
      }

      const oversizeFile = files.find(
        (f) => Number(f?.size || 0) > MAX_PDF_BYTES,
      );

      if (oversizeFile) {
        return res.status(400).json({
          success: false,
          error: `PDF file is too large. Max 50 MB per PDF. Invalid file: ${
            oversizeFile.name || "unknown"
          }`,
        });
      }

      resetReadingStatus();

      setReadingStatus({
        status: "running",
        stage: "queued",
        progress: 0,
        totalFiles: files.length,
        currentFileIndex: null,
        currentFileName: null,
        message: "Form32AS / Form26AS PDF extraction started",
        data: null,
        error: null,
      });

      res.status(202).json({
        success: true,
        message: "Form32AS / Form26AS PDF extraction started",
        readingStatus,
      });

      (async () => {
        try {
          const extractedResults = [];
          const pdfFiles = [];

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileName = file?.name || `file-${i + 1}.pdf`;

            setReadingStatus({
              status: "running",
              stage: "reading_pdf",
              progress: Math.min(
                10 + Math.floor((i / Math.max(files.length, 1)) * 30),
                40,
              ),
              currentFileIndex: i + 1,
              totalFiles: files.length,
              currentFileName: fileName,
              message: `Reading ${fileName}`,
              error: null,
            });

            const buffer = await getFileBuffer(file);

            if (!buffer) {
              throw new Error(`Could not read uploaded file: ${fileName}`);
            }

            setReadingStatus({
              status: "running",
              stage: "deterministic_pdf_extract",
              progress: Math.min(
                40 + Math.floor((i / Math.max(files.length, 1)) * 35),
                75,
              ),
              currentFileIndex: i + 1,
              totalFiles: files.length,
              currentFileName: fileName,
              message: `Reading table text using pdf-parse and pdfjs-dist for ${fileName}`,
              error: null,
            });

            const deterministic =
              await extractForm26ASUsingDeterministicParsers(buffer, fileName);

            let extracted = deterministic.result;
            let parserUsed = deterministic.parserUsed || "deterministic-parser";

            if (!hasUsefulForm26ASExtraction(extracted)) {
              setReadingStatus({
                status: "running",
                stage: "ocr_fallback",
                progress: Math.min(
                  75 + Math.floor((i / Math.max(files.length, 1)) * 15),
                  90,
                ),
                currentFileIndex: i + 1,
                totalFiles: files.length,
                currentFileName: fileName,
                message: `Table text not readable properly. Using Gemini OCR fallback for ${fileName}`,
                error: null,
              });

              extracted = await extractForm26ASUsingGemini(buffer, fileName, {
                currentFileIndex: i + 1,
                totalFiles: files.length,
              });

              parserUsed = `${parserUsed} + gemini-ocr-fallback-with-retry`;
            }

            extractedResults.push(extracted);

            pdfFiles.push({
              pdfName: fileName,
              sizeBytes: buffer.length,
              pdfType: extracted.pdfType,
              parserUsed,
              partIRowCount: Number(
                extracted.form26ASSummary?.partIRowCount || 0,
              ),
              partIIRowCount: Number(
                extracted.form26ASSummary?.partIIRowCount || 0,
              ),
            });
          }

          const mergedResult = mergeForm26ASResults(extractedResults);

          const processingInfo = {
            originalUploadedFiles: files.length,
            processedFiles: files.length,
            parser:
              "pdf-parse + pdfjs-dist positional extraction with Gemini OCR fallback",
            geminiModels: GEMINI_MODELS,
          };

          const finalData = toFlatForm32ASData(
            {
              ...mergedResult,
              pdfFiles,
              processingInfo,
            },
            pdfFiles,
            processingInfo,
          );

          console.log("FINAL Form32AS DATA KEYS =>", Object.keys(finalData));

          setReadingStatus({
            status: "completed",
            stage: "completed",
            progress: 100,
            currentFileIndex: files.length,
            totalFiles: files.length,
            currentFileName: null,
            message: "Form32AS / Form26AS PDF data extracted successfully",
            data: finalData,
            error: null,
          });
        } catch (error) {
          console.error(
            "Error extracting Form32AS/Form26AS PDF data:",
            safeErrorText(error),
          );

          setReadingStatus({
            status: "failed",
            stage: "failed",
            progress: 100,
            currentFileName: null,
            message:
              error.message || "Failed to extract Form32AS/Form26AS PDF data",
            error:
              error.message || "Failed to extract Form32AS/Form26AS PDF data",
            data: null,
          });
        }
      })();
    } catch (error) {
      console.error(
        "Error starting Form32AS/Form26AS PDF extraction:",
        safeErrorText(error),
      );

      setReadingStatus({
        status: "failed",
        stage: "failed",
        progress: 100,
        currentFileName: null,
        message:
          error.message || "Failed to start Form32AS/Form26AS PDF extraction",
        error:
          error.message || "Failed to start Form32AS/Form26AS PDF extraction",
        data: null,
      });

      return res.status(500).json({
        success: false,
        error:
          error.message || "Failed to start Form32AS/Form26AS PDF extraction",
      });
    }
  },

  getForm32AsPdfExtractionStatus: async (req, res) => {
    try {
      res.set({
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "Surrogate-Control": "no-store",
        "Last-Modified": new Date().toUTCString(),
        ETag: `"${Date.now()}"`,
      });

      const safeReadingStatus = {
        ...readingStatus,
        data: readingStatus?.data
          ? toFlatForm32ASData(readingStatus.data)
          : readingStatus.data,
      };

      return res.status(200).json({
        success: true,

        // keep old structure
        readingStatus: safeReadingStatus,

        // add direct values so frontend can read easily
        status: safeReadingStatus.status,
        stage: safeReadingStatus.stage,
        progress: safeReadingStatus.progress,
        message: safeReadingStatus.message,
        error: safeReadingStatus.error,
        data: safeReadingStatus.data,
      });
    } catch (error) {
      console.error(
        "Error getting Form32AS/Form26AS PDF extraction status:",
        safeErrorText(error),
      );

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get reading status",
      });
    }
  },
};
