const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");
const { GoogleGenAI, createPartFromUri } = require("@google/genai");
const pdfParse = require("pdf-parse");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB per uploaded PDF

// Big PDF handling
const BIG_PDF_BYTES = Number(process.env.BIG_PDF_BYTES || 15 * 1024 * 1024); // 15 MB
const BIG_PDF_PAGE_THRESHOLD = Number(process.env.BIG_PDF_PAGE_THRESHOLD || 25);
const PDF_CHUNK_PAGE_COUNT = Number(process.env.PDF_CHUNK_PAGE_COUNT || 12);

// Retry / polling handling
const GEMINI_GENERATE_RETRIES = Number(
  process.env.GEMINI_GENERATE_RETRIES || 3,
);
const GEMINI_RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS || 3000);
const GEMINI_FILE_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_POLL_INTERVAL_MS || 2000,
);
const GEMINI_FILE_PROCESSING_TIMEOUT_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_TIMEOUT_MS || 15 * 60 * 1000,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let readingStatus = {
  status: "idle", // idle | running | completed | failed
  stage: "idle",
  progress: 0,
  message: "No active process",
  currentFileIndex: null,
  totalFiles: 0,
  currentFileName: null,
  fileState: null,
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
    fileState: null,
    data: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

function safeFileState(state) {
  if (!state) return "UNKNOWN";
  if (typeof state === "string") return state.toUpperCase();
  if (typeof state === "object" && state.name) {
    return String(state.name).toUpperCase();
  }
  return String(state).toUpperCase();
}

function isMeaningfulValue(v) {
  return !(
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "")
  );
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

  for (const item of arr) {
    const key = stableStringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function mergeFlatObject(base = {}, incoming = {}) {
  const out = { ...base };

  for (const [key, value] of Object.entries(incoming || {})) {
    if (!isMeaningfulValue(out[key]) && isMeaningfulValue(value)) {
      out[key] = value;
    }
  }

  return out;
}

function mergeExtractionResults(base = {}, incoming = {}) {
  const out = { ...base };

  for (const [key, value] of Object.entries(incoming || {})) {
    if (Array.isArray(value)) {
      const prev = Array.isArray(out[key]) ? out[key] : [];
      out[key] = dedupeObjectArray([...prev, ...value]);
      continue;
    }

    if (value && typeof value === "object") {
      const prev = out[key] && typeof out[key] === "object" ? out[key] : {};
      out[key] = mergeFlatObject(prev, value);
      continue;
    }

    if (!isMeaningfulValue(out[key]) && isMeaningfulValue(value)) {
      out[key] = value;
    }
  }

  return out;
}

function normalizeResultShape(data = {}) {
  return {
    documentTypeOrDocumentHeading: data.documentTypeOrDocumentHeading ?? null,
    invoiceType: data.invoiceType ?? null,
    ProformaInvNo: data.ProformaInvNo ?? null,
    CustomerCode: data.CustomerCode ?? null,
    CustomerName: data.CustomerName ?? null,
    CustomerAddress: data.CustomerAddress ?? null,
    gstinNo: data.gstinNo ?? null,
    irnNo: data.irnNo ?? null,
    stateName: data.stateName ?? null,
    creditLimit: data.creditLimit ?? null,
    poNo: data.poNo ?? null,
    icpCodeBuyer: data.icpCodeBuyer ?? null,
    icpCodeSeller: data.icpCodeSeller ?? null,
    invoiceNo: data.invoiceNo ?? null,
    invoiceDate: data.invoiceDate ?? null,
    gtiGstin: data.gtiGstin ?? null,
    panNo: data.panNo ?? null,
    tanNo: data.tanNo ?? null,
    VesselCallNo: data.VesselCallNo ?? null,
    rawVesselOrVoyageText: data.rawVesselOrVoyageText ?? null,
    rawVesselText: data.rawVesselText ?? null,
    rawVoyageText: data.rawVoyageText ?? null,
    vesselName: data.vesselName ?? null,
    voyageName: data.voyageName ?? null,
    timeOfArrival: data.timeOfArrival ?? null,
    timeOfDeparture: data.timeOfDeparture ?? null,
    trainNo: data.trainNo ?? null,
    trainArrivalTime: data.trainArrivalTime ?? null,
    trainDepartureTime: data.trainDepartureTime ?? null,
    ackNo: data.ackNo ?? null,
    ackDate: data.ackDate ?? null,
    activityCode: data.activityCode ?? null,
    icfHfm: data.icfHfm ?? null,
    tblCharges: Array.isArray(data.tblCharges) ? data.tblCharges : [],
    chargesTotal:
      data.chargesTotal && typeof data.chargesTotal === "object"
        ? data.chargesTotal
        : {},
    tblContainer: Array.isArray(data.tblContainer) ? data.tblContainer : [],
    containerTotal:
      data.containerTotal && typeof data.containerTotal === "object"
        ? data.containerTotal
        : {},
  };
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildPdfFilesSummary(workItems = []) {
  const map = new Map();

  for (const item of workItems) {
    const pdfName = item.originalFileName || item.displayName || "upload.pdf";

    if (!map.has(pdfName)) {
      map.set(pdfName, {
        pdfName,
        pages: item.totalPages ?? null,
        sizeBytes: item.originalSizeBytes ?? item.sizeBytes ?? null,
        wasChunked: !!item.wasChunked,
        chunkCount: item.partCount || 1,
      });
      continue;
    }

    const existing = map.get(pdfName);

    existing.pages = existing.pages ?? item.totalPages ?? null;
    existing.sizeBytes =
      existing.sizeBytes ?? item.originalSizeBytes ?? item.sizeBytes ?? null;
    existing.wasChunked = existing.wasChunked || !!item.wasChunked;
    existing.chunkCount = Math.max(
      existing.chunkCount || 1,
      item.partCount || 1,
    );
  }

  return [...map.values()];
}

function cleanInvoiceNo(value) {
  if (!value) return null;

  let s = String(value)
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(/^[\s:=#._-]+/, "");
  s = s.replace(/\s*([\/\\-])\s*/g, "$1");

  return s || null;
}

function looksLikeInvoiceNo(value) {
  const s = cleanInvoiceNo(value);
  if (!s) return false;

  if (s.length < 4 || s.length > 60) return false;
  if (!/[0-9]/.test(s)) return false;
  if (!/^[A-Za-z0-9\/._\- ]+$/.test(s)) return false;
  if (/invoice|number|document|bill/i.test(s)) return false;

  return true;
}

function getAmbiguousGroup(ch) {
  const c = String(ch || "").toUpperCase();

  if ("I1L|".includes(c)) return "I_GROUP";
  if ("O0Q".includes(c)) return "O_GROUP";
  if ("B8".includes(c)) return "B_GROUP";
  if ("S5".includes(c)) return "S_GROUP";
  if ("Z2".includes(c)) return "Z_GROUP";
  if ("G6".includes(c)) return "G_GROUP";

  return c;
}

function equivalentExceptAmbiguous(a, b) {
  const x = cleanInvoiceNo(a)?.replace(/\s+/g, "") || "";
  const y = cleanInvoiceNo(b)?.replace(/\s+/g, "") || "";

  if (!x || !y || x.length !== y.length) return false;

  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (getAmbiguousGroup(x[i]) !== getAmbiguousGroup(y[i])) return false;
  }

  return true;
}

function scoreInvoiceCandidate(value, source = "unknown") {
  const s = cleanInvoiceNo(value);
  if (!s) return -Infinity;

  let score = 0;

  if (looksLikeInvoiceNo(s)) score += 10;
  if (/[A-Za-z]/.test(s)) score += 3;
  if (/\d/.test(s)) score += 3;
  if (/[\/-]/.test(s)) score += 3;
  if (/^[A-Za-z][\/-]/.test(s)) score += 5; // important for I/2526/045274
  if (/^\d+$/.test(s)) score -= 5;

  if (source === "pdf_text") score += 100; // always prefer deterministic text layer
  if (source === "gemini_main") score += 5;
  if (source === "gemini_invoice_fallback") score += 3;

  return score;
}

function chooseBestInvoiceNo(candidates = []) {
  const prepared = candidates
    .map((c) => ({
      value: cleanInvoiceNo(c?.value),
      source: c?.source || "unknown",
    }))
    .filter((c) => c.value);

  if (!prepared.length) return null;

  prepared.sort(
    (a, b) =>
      scoreInvoiceCandidate(b.value, b.source) -
      scoreInvoiceCandidate(a.value, a.source),
  );

  return prepared[0].value;
}

async function extractInvoiceNoFromPdfTextBuffer(buffer) {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) return null;

    const parsed = await pdfParse(buffer);
    const rawText = String(parsed?.text || "");
    if (!rawText.trim()) return null;

    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.replace(/\u00A0/g, " ").trim())
      .filter(Boolean);

    const candidates = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Case 1: label and value on same line
      let m = line.match(
        /^(?:tax\s+)?invoice\s*(?:number|no\.?|#)?\s*[:\-]?\s*(.+)$/i,
      );
      if (m?.[1]) {
        candidates.push(m[1]);
      }

      // Case 2: label on one line, value on next line
      if (/^(?:tax\s+)?invoice\s*(?:number|no\.?|#)?$/i.test(line)) {
        if (lines[i + 1]) candidates.push(lines[i + 1]);
        if (lines[i + 2] && !looksLikeInvoiceNo(lines[i + 1])) {
          candidates.push(lines[i + 2]);
        }
      }
    }

    const cleaned = candidates.map(cleanInvoiceNo).filter(looksLikeInvoiceNo);

    if (!cleaned.length) return null;

    cleaned.sort(
      (a, b) =>
        scoreInvoiceCandidate(b, "pdf_text") -
        scoreInvoiceCandidate(a, "pdf_text"),
    );

    return cleaned[0];
  } catch (error) {
    console.error("extractInvoiceNoFromPdfTextBuffer failed:", error);
    return null;
  }
}

function cleanInvoiceNoCandidate(value) {
  if (!value) return null;

  let s = String(value)
    .replace(/\u00A0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  s = s.replace(/^[\s:=#|._-]+/, "");
  s = s.replace(/\s+$/g, "");
  s = s.replace(/\s*([\/\\-])\s*/g, "$1");
  s = s.replace(/\s{2,}/g, " ");

  return s || null;
}

function looksLikeInvoiceNo(value) {
  const s = cleanInvoiceNoCandidate(value);
  if (!s) return false;

  if (s.length < 4 || s.length > 60) return false;
  if (/invoice|number|document|bill|tax\s+invoice/i.test(s)) return false;
  if (!/[0-9]/.test(s)) return false;
  if (!/^[A-Za-z0-9\/._\- ]+$/.test(s)) return false;

  return true;
}

function getAmbiguousInvoiceCharGroup(ch) {
  const c = String(ch || "").toUpperCase();

  if ("I1L|".includes(c)) return "I_GROUP";
  if ("O0Q".includes(c)) return "O_GROUP";
  if ("B8".includes(c)) return "B_GROUP";
  if ("S5".includes(c)) return "S_GROUP";
  if ("Z2".includes(c)) return "Z_GROUP";
  if ("G6".includes(c)) return "G_GROUP";

  return c;
}

function areEquivalentExceptAmbiguousChars(a, b) {
  const x = cleanInvoiceNoCandidate(a)?.replace(/\s+/g, "") || "";
  const y = cleanInvoiceNoCandidate(b)?.replace(/\s+/g, "") || "";

  if (!x || !y || x.length !== y.length) return false;

  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;

    if (
      getAmbiguousInvoiceCharGroup(x[i]) !== getAmbiguousInvoiceCharGroup(y[i])
    ) {
      return false;
    }
  }

  return true;
}

function scoreInvoiceNoCandidate(value, source = "unknown") {
  const s = cleanInvoiceNoCandidate(value);
  if (!s) return -Infinity;

  let score = 0;

  if (looksLikeInvoiceNo(s)) score += 8;
  if (/[A-Za-z]/.test(s)) score += 3;
  if (/\d/.test(s)) score += 3;
  if (/[\/-]/.test(s)) score += 3;
  if (/^[A-Za-z][\/-]/.test(s)) score += 3; // e.g. I/2526/045274
  if (/^[A-Za-z0-9][A-Za-z0-9\/._\- ]*$/.test(s)) score += 2;
  if (/^\d+$/.test(s)) score -= 4;
  if (/invoice|number|document|bill/i.test(s)) score -= 10;

  if (source === "pdf_text") score += 5;
  if (source === "gemini_invoice_fallback") score += 2;

  return score;
}

function pickBestInvoiceNo(candidates = []) {
  const prepared = candidates
    .map((item) =>
      typeof item === "string" ? { value: item, source: "unknown" } : item,
    )
    .map((item) => ({
      ...item,
      cleaned: cleanInvoiceNoCandidate(item.value),
    }))
    .filter((item) => item.cleaned);

  if (!prepared.length) return null;

  const strongPdfText = prepared.find(
    (item) => item.source === "pdf_text" && looksLikeInvoiceNo(item.cleaned),
  );

  if (strongPdfText) {
    const corroborated = prepared.some(
      (item) =>
        item !== strongPdfText &&
        areEquivalentExceptAmbiguousChars(item.cleaned, strongPdfText.cleaned),
    );

    if (corroborated) {
      return strongPdfText.cleaned;
    }
  }

  prepared.sort((a, b) => {
    return (
      scoreInvoiceNoCandidate(b.cleaned, b.source) -
      scoreInvoiceNoCandidate(a.cleaned, a.source)
    );
  });

  return prepared[0]?.cleaned || null;
}

async function extractInvoiceNoFromPdfTextBuffer(buffer) {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) return null;

    const parsed = await pdfParse(buffer);
    const rawText = String(parsed?.text || "");

    if (!rawText.trim()) return null;

    const lines = rawText
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);

    const labelOnlyPatterns = [
      /^(?:tax\s+)?invoice\s*(?:number|no\.?|#)?$/i,
      /^(?:bill|document)\s*(?:number|no\.?|#)?$/i,
    ];

    const sameLinePatterns = [
      /^(?:tax\s+)?invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*(.+)$/i,
      /^(?:bill|document)\s*(?:number|no\.?|#)\s*[:\-]?\s*(.+)$/i,
    ];

    const candidates = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of sameLinePatterns) {
        const match = line.match(pattern);
        if (match?.[1]) {
          candidates.push(match[1]);
        }
      }

      for (const pattern of labelOnlyPatterns) {
        if (!pattern.test(line)) continue;

        if (i + 1 < lines.length) candidates.push(lines[i + 1]);
        if (i + 2 < lines.length && !looksLikeInvoiceNo(lines[i + 1])) {
          candidates.push(lines[i + 2]);
        }
      }
    }

    const broadRegex =
      /(?:tax\s+)?(?:invoice|bill|document)\s*(?:number|no\.?|#)?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\/._\- ]{3,60})/gi;

    for (const match of rawText.matchAll(broadRegex)) {
      if (match?.[1]) candidates.push(match[1]);
    }

    return pickBestInvoiceNo(
      candidates.map((value) => ({
        value,
        source: "pdf_text",
      })),
    );
  } catch (error) {
    console.error(
      "PDF text invoice extraction failed:",
      error?.message || error,
    );
    return null;
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

function isRetryableGeminiError(error) {
  const message = String(
    error?.message ||
      error?.cause?.message ||
      error?.cause?.code ||
      error ||
      "",
  ).toLowerCase();

  return [
    "fetch failed",
    "timed out",
    "timeout",
    "headers timeout",
    "und_err_headers_timeout",
    "socket hang up",
    "econnreset",
    "etimedout",
    "503",
    "500",
    "429",
    "resource exhausted",
    "temporarily unavailable",
    "internal error",
    "deadline exceeded",
    "network",
    "overloaded",
  ].some((token) => message.includes(token));
}

async function withRetry(fn, options = {}) {
  const {
    retries = GEMINI_GENERATE_RETRIES,
    baseDelayMs = GEMINI_RETRY_BASE_MS,
    label = "operation",
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      if (attempt > retries || !isRetryableGeminiError(error)) {
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

const S = {
  str: (description) => ({
    type: ["string", "null"],
    description,
  }),
  bool: (description) => ({
    type: ["boolean", "null"],
    description,
  }),
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentTypeOrDocumentHeading: S.str(
      "Main document heading or detected document type. Example: Tax Invoice, Commercial Invoice, Terminal Invoice.",
    ),
    invoiceType: S.str(
      "Invoice type if explicitly present. Example: Tax Invoice, Debit Note, Credit Note, Proforma Invoice.",
    ),
    CustomerCode: S.str(
      "Customer code, client code, party code, or buyer code if present.",
    ),
    ProformaInvNo: S.str("Proforma Inv No if present."), // ProformaInvNo
    CustomerName: S.str("Customer or buyer name."),
    CustomerAddress: S.str("Customer or buyer address."),
    gstinNo: S.str("GSTIN number of the customer or relevant party."),
    irnNo: S.str("IRN number if present."),
    stateName: S.str("State name if present."),
    creditLimit: S.str("Credit limit if present."),
    poNo: S.str("PO number / purchase order number if present."),
    icpCodeBuyer: S.str("ICP code of buyer if present."),
    icpCodeSeller: S.str("ICP code of seller if present."),
    invoiceNo: S.str(
      "Invoice number. May appear as Invoice No, Tax Invoice No, Bill No, Document No.",
    ),
    invoiceDate: S.str(
      "Invoice date in YYYY-MM-DD only when clearly derivable.",
    ),
    gtiGstin: S.str("GTI GSTIN or seller GSTIN if present."),
    panNo: S.str("PAN number if present."),
    tanNo: S.str("TAN number if present."),
    VesselCallNo: S.str("Vessel call number if present."),
    rawVesselOrVoyageText: S.str(
      "Raw printed vessel/voyage text exactly as seen in the PDF, especially when combined in one value like 'EVER LIBRA/EVBR2653'.",
    ),
    rawVesselText: S.str(
      "Raw text exactly under the Vessel label before any cleanup or splitting.",
    ),
    rawVoyageText: S.str(
      "Raw text exactly under the Voyage label before any cleanup.",
    ),
    rawVesselOrVoyageText: S.str(
      "Raw printed vessel/voyage text exactly as seen in the PDF, especially when vessel and voyage/service/via are combined in one value like 'EVER LIBRA/EVBR2653'.",
    ),
    rawVesselText: S.str(
      "Raw text exactly under labels such as Vessel, Vessel Name, or similar before any cleanup or splitting.",
    ),
    rawVoyageText: S.str(
      "Raw text exactly under labels such as Voyage, Voyage No, VIA, Via, Service, Service/Voyage, or similar before any cleanup.",
    ),
    vesselName: S.str(
      "Vessel name only. This may appear under labels such as 'Vessel', 'Vessel Name', or similar. If combined text like 'EVER LIBRA/EVBR2653' is present, extract only 'EVER LIBRA' here when clearly separable.",
    ),
    voyageName: S.str(
      "Voyage name/code only. This may appear under labels such as 'Voyage', 'Voyage No', 'VIA', 'Via', 'Service', or similar. If combined text like 'EVER LIBRA/EVBR2653' is present, extract only 'EVBR2653' here when clearly separable. If the PDF has a separate label 'VIA' next to 'VESSEL NAME', treat the VIA value as voyageName.",
    ),
    timeOfArrival: S.str(
      "Time/date of arrival in YYYY-MM-DD or datetime only when clearly derivable.",
    ),
    timeOfDeparture: S.str(
      "Time/date of departure in YYYY-MM-DD or datetime only when clearly derivable.",
    ),
    trainNo: S.str("Train number if present."),
    trainArrivalTime: S.str(
      "Train arrival time/date if present and clearly derivable.",
    ),
    trainDepartureTime: S.str(
      "Train departure time/date if present and clearly derivable.",
    ),
    ackNo: S.str("Acknowledgement number if present."),
    ackDate: S.str("Acknowledgement date if present."),
    activityCode: S.str("Activity code if present."),
    icfHfm: S.str("ICF/HFM value if present."),

    tblCharges: {
      type: "array",
      description:
        "Charge/tariff rows extracted from the invoice table. If the SERVICE column contains grouped section headings, store that heading in serviceGroup and repeat it for each related row.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sNo: S.str("Serial number of the row."),
          serviceGroup: S.str(
            "Grouped section heading shown in the SERVICE column above a set of charge rows. Example: 'STEVEDORING/ TERMINAL HANDLING CHARGES (IMPORT -'. Repeat this same value for each charge row until the next grouped heading appears.",
          ),
          service: S.str("Raw SERVICE column value as printed in the PDF."),
          serviceDescription: S.str(
            "Actual charge line description. Example: 'CONTAINER LADEN 20\"'. Do not use grouped section headings here unless the PDF truly treats them as a row.",
          ),
          sac: S.str("Raw SAC column value as printed in the PDF."),
          sacCode: S.str("SAC code."),
          sacPercent: S.str("SAC percentage."),
          qty: S.str("Raw QTY column value as printed in the PDF."),
          unitQtyPerDay: S.str("Unit quantity per day."),
          uom: S.str("Unit of measure. Example: CNT."),
          rate: S.str("Raw RATE column value as printed in the PDF."),
          tariffRate: S.str("Tariff rate."),
          tariffCurrency: S.str("Tariff currency."),
          exchRate: S.str("Exchange rate."),
          amountInTariffCurrency: S.str("Amount in tariff currency."),
          amountInINR: S.str("Amount in INR."),
          sgst: S.str("SGST amount."),
          cgst: S.str("CGST amount."),
          igst: S.str("IGST amount."),
          tariffCode: S.str(
            "Tariff code if this column exists in the charges table.",
          ),
          tariff: S.str(
            "Tariff value if this column exists in the charges table.",
          ),
          exRate: S.str(
            "Exchange rate if printed as Ex. Rate in the charges table.",
          ),
          exDate: S.str(
            "Exchange date if printed as Ex. Date in the charges table.",
          ),
          amount: S.str(
            "Amount if printed as a separate amount column in the charges table.",
          ),
          containerNo: S.str(
            "Container number if charges table includes container reference.",
          ),
          container: S.str("Container reference if printed as Container."),
          fe: S.str("Full/Empty indicator if present in the charges table."),
          size: S.str("Container size if present in the charges table."),
          iso: S.str("ISO code if present in the charges table."),
          weight: S.str("Weight if present in the charges table."),
        },
        required: [],
      },
    },

    chargesTotal: {
      type: "object",
      additionalProperties: false,
      description: "Invoice summary amounts shown in the totals/summary box.",
      properties: {
        actual: S.str("Actual amount."),
        total: S.str("Total amount."),
        advance: S.str("Advance amount."),
        balanceInvoice: S.str("Balance invoice amount."),
      },
      required: [],
    },

    tblContainer: {
      type: "array",
      description: "Container detail rows extracted from the container table.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chargeGroup: S.str(
            "Grouped label shown at the left side of the container table.",
          ),
          no: S.str("Serial number of the row."),
          containerNo: S.str("Container number."),
          container: S.str("Container reference if printed as Container."),
          fe: S.str("Full/Empty indicator, usually F or E."),
          size: S.str("Container size, for example 20 or 40."),
          iso: S.str("ISO code, for example 22G1."),
          weight: S.str("Container weight as printed in the PDF."),
          rate: S.str("Rate as printed in the PDF."),
          tariffCode: S.str("Tariff Code."),
          tariff: S.str("Tariff $ / ₹."),
          exRate: S.str("Ex. Rate."),
          exDate: S.str("Ex. Date."),
          amount: S.str("Amount."),
        },
        required: [],
      },
    },

    containerTotal: {
      type: "object",
      additionalProperties: false,
      description: "Invoice Sub Total after the container table.",
      properties: {
        containerSubTotal: S.str("Sub Total."),
      },
      required: [],
    },
  },
  required: [],
};

const CONTAINER_ONLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tblContainer: EXTRACTION_SCHEMA.properties.tblContainer,
    containerTotal: EXTRACTION_SCHEMA.properties.containerTotal,
  },
  required: [],
};

const INVOICE_NO_ONLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    invoiceNo: S.str(
      "Invoice number exactly as printed in the PDF, preserving letters, numbers, slashes, hyphens, spaces, prefixes, and suffixes.",
    ),
  },
  required: [],
};

function buildTaskPrompt(fileNames = []) {
  return `
You are a high-accuracy invoice and logistics PDF extraction engine.

Extract data from the provided PDF files and return ONLY valid JSON matching the schema.

Rules:
1. Do not guess values.
2. If a value is not clearly present, return null.
3. Map labels intelligently. For example:
   - invoiceNo may appear as Invoice No, Tax Invoice No, Bill No, Document No
   - invoiceDate may appear as Invoice Date, Bill Date, Document Date
   - CustomerCode may appear as Customer Code, Client Code, Party Code
   - CustomerName may appear as Buyer Name, Customer Name, Party Name
   - gstinNo may appear as GSTIN, GST No, GSTIN/UIN
   - irnNo may appear as IRN, Invoice Reference Number
   - poNo may appear as PO No, Purchase Order No
   - VesselCallNo may appear as Vessel Call No, Call No
   - vesselName may appear as Vessel, Vessel Name
   - vesselName may appear as Vessel, Vessel Name, MV, Mother Vessel
   - voyageName may appear as Voyage, Voyage No, Voyage Code, VIA, Via, Service, Service/Voyage
   - ackNo may appear as Ack No, Acknowledgement No
   - ackDate may appear as Ack Date, Acknowledgement Date
   - tariffCode may appear as Tariff Code, TariffCode
   - tariff may appear as Tariff
   - exRate may appear as Ex. Rate, Exchange Rate, Ex Rate
   - exDate may appear as Ex. Date, Exchange Date, Ex Date
   - amount may appear as Amount
   - containerNo may appear as Container No, Container Number, Cntr No
   - container may appear as Container
   - fe may appear as F/E, Full/Empty, Full Empty
   - iso may appear as ISO, ISO Code
   - rate may appear as Rate, Tariff Rate
   - weight may appear as Weight, Gross Weight, Net Weight if only one weight column is present

4. Preserve identifier values exactly as printed in the document.
   - Do not change letters into numbers or numbers into letters.
   - Do not auto-correct or normalize alphanumeric identifiers.
   - This applies especially to invoiceNo, ackNo, irnNo, containerNo, CustomerCode, VesselCallNo, vesselName, voyageName, tariffCode, GSTIN, PAN, TAN, trainNo, and similar identifiers.
   - Preserve prefixes, suffixes, slashes, hyphens, spaces, and mixed alphanumeric patterns exactly as printed when they are visible.

5. For visually ambiguous characters in identifiers, be very careful.
   - Characters such as I and 1, O and 0, B and 8, S and 5, Z and 2, G and 6 can look similar in PDFs.
   - Do not replace one with the other unless the document clearly shows it.
   - Prefer the exact printed text over pattern-based correction.
   - If the identifier is visible, extract it exactly as shown in the PDF.

6. Extract all visible rows from the charges table into "tblCharges".
7. Preserve raw printed charge-table columns where available:
   - SERVICE -> service
   - SAC -> sac
   - QTY -> qty
   - UOM -> uom
   - RATE -> rate
   - AMOUNT(INR) -> amountInINR

8. Also map normalized values where clearly possible:
   - serviceDescription from the actual charge line text
   - sacCode from SAC
   - unitQtyPerDay from QTY
   - tariffRate from RATE when RATE is the relevant rate field

9. IMPORTANT FOR GROUPED SERVICE HEADINGS:
   - Some charge tables contain section/group headings inside the SERVICE column.
   - Example: "STEVEDORING/ TERMINAL HANDLING CHARGES (IMPORT -"
   - These headings are not normal charge rows when they do not have their own qty/rate/amount values.
   - Store such headings in "serviceGroup".
   - Repeat the same "serviceGroup" value for each following charge row until the next grouped heading appears.
   - The actual service rows such as "CONTAINER LADEN 20\\"" and "CONTAINER LADEN 40\\"" must remain in "service" and/or "serviceDescription".
   - Do NOT place grouped service headings into tblContainer.

10. If the charges table contains columns such as Tariff Code, Container, Tariff, Ex. Rate, Ex. Date, or Amount, map them into the corresponding fields in "tblCharges".

11. Extract the totals/summary box into "chargesTotal":
   - Actual -> actual
   - Total -> total
   - Advance -> advance
   - Balance Invoice -> balanceInvoice

12. Extract all visible rows from the container details table into "tblContainer".
13. In "tblContainer", keep one object per visible row. Do not merge rows.
14. If the same left-side grouped description applies to multiple rows, repeat it in each row as chargeGroup.
15. If the container table includes extra columns such as Tariff Code, Tariff, Ex. Rate, Ex. Date, Amount, Rate, Weight, ISO, or Container No, map them into the matching fields in "tblContainer".
16. Keep monetary values, codes, dates, and table values exactly as printed in the PDF unless clearly normalizing a date is possible.
17. Return dates in YYYY-MM-DD only when clearly derivable from the document. Otherwise keep the original printed value.
18. Do not invent missing rows, totals, or container values.
19. SPECIAL RULE FOR VESSEL / VIA LAYOUT:
   - If the PDF shows a field labeled 'VESSEL NAME', map it to vesselName.
   - If the PDF shows a field labeled 'VIA', map it to voyageName.
   - Do not treat 'VIA' as a route description when it is clearly paired with vessel details and contains a voyage/service code.

File names:
${fileNames.join(", ") || "N/A"}
`;
}

function buildChunkTaskPrompt(workItem) {
  const basePrompt = buildTaskPrompt([
    workItem.originalFileName || workItem.displayName,
  ]);

  return `
${basePrompt}

IMPORTANT CHUNK RULES:
- You are receiving only part ${workItem.partIndex} of ${workItem.partCount} of the same PDF document.
- Extract ONLY what is visible in this chunk.
- If a header field, summary total, charge row, or container row is not visible in this chunk, return null or [] for this chunk.
- Do not invent values from other unseen pages.
- Do not assume earlier or later pages.
- The final application will merge chunk outputs together.
`;
}

function buildContainerOnlyPrompt(workItem) {
  const fileName = workItem.originalFileName || workItem.displayName || "N/A";

  return `
You are a high-accuracy PDF extraction engine.

Your task is to extract ONLY the container table and container subtotal from this PDF.

Return ONLY valid JSON matching the schema.

Rules:
1. Focus only on the container details section/table.
2. Extract all visible rows from the container details table into "tblContainer".
3. Keep one object per visible row. Do not merge rows.
4. If the same grouped description applies to multiple rows, repeat it in each row as chargeGroup.
5. Map these fields when visible:
   - no
   - containerNo
   - container
   - fe
   - size
   - iso
   - weight
   - rate
   - tariffCode
   - tariff
   - exRate
   - exDate
   - amount
6. Extract subtotal after the container table into:
   - containerTotal.containerSubTotal
7. Do not extract charges table rows into tblContainer.
8. Do not guess values.
9. If container table is truly not present, return an empty array.

File name:
${fileName}
`;
}

function buildInvoiceNoOnlyPrompt(workItem) {
  const fileName = workItem.originalFileName || workItem.displayName || "N/A";

  return `
You are a high-accuracy PDF extraction engine.

Your task is to extract ONLY the invoice number from this PDF.

Return ONLY valid JSON matching the schema.

Rules:
1. Extract only the value for invoiceNo.
2. invoiceNo may appear as:
   - Invoice No
   - Invoice Number
   - Tax Invoice No
   - Bill No
   - Document No
3. Preserve the invoice number exactly as printed in the PDF.
4. Do not change letters into numbers or numbers into letters.
5. Be very careful with visually similar characters such as:
   - I and 1
   - O and 0
   - B and 8
   - S and 5
   - Z and 2
   - G and 6
6. Preserve slashes, hyphens, spaces, prefixes, and suffixes exactly as printed.
7. Do not auto-correct, normalize, or infer the invoice number.
8. If the invoice number is not clearly visible, return null.

File name:
${fileName}
`;
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

async function ensureUploadInput(file) {
  if (file?.tempFilePath) {
    return {
      uploadInput: file.tempFilePath,
      cleanup: async () => {},
    };
  }

  const buffer = await getFileBuffer(file);

  if (!buffer) {
    throw new Error(
      `Could not read uploaded file buffer for ${file?.name || "unknown file"}`,
    );
  }

  const tempName = `${Date.now()}-${crypto.randomUUID()}-${file?.name || "upload.pdf"}`;
  const tempPath = path.join(os.tmpdir(), tempName);

  await fs.writeFile(tempPath, buffer);

  return {
    uploadInput: tempPath,
    cleanup: async () => {
      try {
        await fs.unlink(tempPath);
      } catch (e) {}
    },
  };
}

async function getPdfPageCount(buffer) {
  const pdf = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  return pdf.getPageCount();
}

async function splitPdfBufferToTempFiles(buffer, originalName, chunkPageCount) {
  const srcPdf = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const totalPages = srcPdf.getPageCount();
  const partCount = Math.ceil(totalPages / chunkPageCount);
  const safeBaseName = String(originalName || "upload.pdf").replace(
    /\.pdf$/i,
    "",
  );

  const items = [];

  for (let start = 0; start < totalPages; start += chunkPageCount) {
    const end = Math.min(start + chunkPageCount, totalPages);
    const chunkPdf = await PDFDocument.create();
    const pageIndexes = [];

    for (let i = start; i < end; i++) {
      pageIndexes.push(i);
    }

    const copiedPages = await chunkPdf.copyPages(srcPdf, pageIndexes);
    copiedPages.forEach((page) => chunkPdf.addPage(page));

    const bytes = await chunkPdf.save();
    const chunkBuffer = Buffer.from(bytes);
    const textInvoiceCandidate =
      await extractInvoiceNoFromPdfTextBuffer(chunkBuffer);
    const partIndex = Math.floor(start / chunkPageCount) + 1;
    const displayName = `${safeBaseName}__part_${partIndex}_of_${partCount}.pdf`;
    const tempPath = path.join(
      os.tmpdir(),
      `${Date.now()}-${crypto.randomUUID()}-${displayName}`,
    );

    await fs.writeFile(tempPath, Buffer.from(bytes));

    items.push({
      originalFileName: originalName || "upload.pdf",
      displayName,
      uploadInput: tempPath,
      cleanup: async () => {
        try {
          await fs.unlink(tempPath);
        } catch (e) {}
      },
      wasChunked: true,
      partIndex,
      partCount,
      startPage: start + 1,
      endPage: end,
      totalPages,
      sizeBytes: chunkBuffer.length,
      textInvoiceCandidate,
      originalSizeBytes: buffer.length,
    });
  }

  return items;
}

async function buildWorkItems(files) {
  const workItems = [];

  for (const file of files) {
    const displayName = file?.name || "upload.pdf";
    const buffer = await getFileBuffer(file);
    const textInvoiceCandidate =
      await extractInvoiceNoFromPdfTextBuffer(buffer);
    if (!buffer) {
      throw new Error(`Could not read uploaded file: ${displayName}`);
    }

    let pageCount = null;
    try {
      pageCount = await getPdfPageCount(buffer);
    } catch (e) {
      pageCount = null;
    }

    const shouldChunk =
      buffer.length >= BIG_PDF_BYTES ||
      (Number.isFinite(pageCount) && pageCount > BIG_PDF_PAGE_THRESHOLD);

    if (shouldChunk && Number.isFinite(pageCount) && pageCount > 1) {
      const chunkItems = await splitPdfBufferToTempFiles(
        buffer,
        displayName,
        PDF_CHUNK_PAGE_COUNT,
      );
      workItems.push(...chunkItems);
      continue;
    }

    const { uploadInput, cleanup } = await ensureUploadInput(file);

    workItems.push({
      originalFileName: displayName,
      displayName,
      uploadInput,
      cleanup,
      wasChunked: false,
      partIndex: 1,
      partCount: 1,
      startPage: 1,
      endPage: pageCount || null,
      totalPages: pageCount || null,
      sizeBytes: buffer.length,
      originalSizeBytes: buffer.length,
      textInvoiceCandidate,
    });
  }

  return workItems;
}

async function uploadAndWaitForFile(workItem, index, totalItems) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;
  const cleanupLocalFile = workItem.cleanup || (async () => {});
  let uploadedName = null;

  try {
    setReadingStatus({
      status: "running",
      stage: "reading_local_file",
      progress: Math.min(
        10 + Math.floor((index / Math.max(totalItems, 1)) * 25),
        35,
      ),
      currentFileIndex: index + 1,
      totalFiles: totalItems,
      currentFileName: displayName,
      message: `Preparing ${displayName}`,
      error: null,
    });

    const uploaded = await withRetry(
      async () => {
        setReadingStatus({
          status: "running",
          stage: "uploading_to_gemini",
          progress: Math.min(
            20 + Math.floor((index / Math.max(totalItems, 1)) * 25),
            45,
          ),
          currentFileIndex: index + 1,
          totalFiles: totalItems,
          currentFileName: displayName,
          message: `Uploading ${displayName} to Gemini`,
          error: null,
        });

        return await ai.files.upload({
          file: workItem.uploadInput,
          config: {
            mimeType: "application/pdf",
            displayName,
          },
        });
      },
      {
        label: `upload ${displayName}`,
        onRetry: (error, attempt, delayMs) => {
          setReadingStatus({
            status: "running",
            stage: "retrying_upload",
            currentFileIndex: index + 1,
            totalFiles: totalItems,
            currentFileName: displayName,
            message: `Retrying upload for ${displayName} (attempt ${attempt + 1}) after ${delayMs} ms`,
            error: error?.message || String(error),
          });
        },
      },
    );

    uploadedName = uploaded.name;

    const startedAt = Date.now();

    let fetchedFile = await withRetry(
      async () => await ai.files.get({ name: uploaded.name }),
      {
        label: `get uploaded file ${displayName}`,
      },
    );

    let pollCounter = 0;

    while (safeFileState(fetchedFile.state) === "PROCESSING") {
      if (Date.now() - startedAt > GEMINI_FILE_PROCESSING_TIMEOUT_MS) {
        throw new Error(
          `Gemini file processing timed out for ${displayName} after ${Math.round(
            GEMINI_FILE_PROCESSING_TIMEOUT_MS / 1000,
          )} seconds`,
        );
      }

      const loopProgressBase =
        45 + Math.floor((index / Math.max(totalItems, 1)) * 15);
      const loopProgress = Math.min(
        loopProgressBase + Math.min(pollCounter * 2, 12),
        70,
      );

      setReadingStatus({
        status: "running",
        stage: "gemini_processing_file",
        progress: loopProgress,
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        fileState: safeFileState(fetchedFile.state),
        message: `Gemini is processing ${displayName}`,
        error: null,
      });

      await sleep(GEMINI_FILE_POLL_INTERVAL_MS);

      fetchedFile = await withRetry(
        async () => await ai.files.get({ name: uploaded.name }),
        {
          label: `poll file ${displayName}`,
        },
      );

      pollCounter += 1;
    }

    if (safeFileState(fetchedFile.state) === "FAILED") {
      throw new Error(`Gemini failed to process file: ${displayName}`);
    }

    setReadingStatus({
      status: "running",
      stage: "gemini_file_ready",
      progress: Math.min(60 + Math.floor(((index + 1) / totalItems) * 10), 75),
      currentFileIndex: index + 1,
      totalFiles: totalItems,
      currentFileName: displayName,
      fileState: safeFileState(fetchedFile.state),
      message: `${displayName} is ready for extraction`,
      error: null,
    });

    return {
      fetchedFile,
      uploadedName,
    };
  } catch (error) {
    if (uploadedName) {
      try {
        await ai.files.delete({ name: uploadedName });
      } catch (e) {}
    }
    throw error;
  } finally {
    await cleanupLocalFile();
  }
}

async function deleteGeminiFiles(fileNames = []) {
  for (const name of fileNames) {
    try {
      await ai.files.delete({ name });
    } catch (e) {}
  }
}

async function extractContainerFallbackFromGemini(
  fetchedFile,
  workItem,
  index,
  totalItems,
) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;

  const response = await withRetry(
    async () => {
      setReadingStatus({
        status: "running",
        stage: "extracting_container_fallback",
        progress: Math.min(
          82 + Math.floor((index / Math.max(totalItems, 1)) * 10),
          96,
        ),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Retrying container extraction for ${displayName}`,
        error: null,
      });

      const contents = [
        buildContainerOnlyPrompt(workItem),
        createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
      ];

      return await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Prefer empty array over guessing. Follow the schema exactly.",
          responseMimeType: "application/json",
          responseJsonSchema: CONTAINER_ONLY_SCHEMA,
        },
      });
    },
    {
      label: `container fallback ${displayName}`,
      onRetry: (error, attempt, delayMs) => {
        setReadingStatus({
          status: "running",
          stage: "retrying_container_fallback",
          currentFileIndex: index + 1,
          totalFiles: totalItems,
          currentFileName: displayName,
          message: `Retrying container fallback for ${displayName} (attempt ${attempt + 1}) after ${delayMs} ms`,
          error: error?.message || String(error),
        });
      },
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (jsonError) {
    console.error("Gemini raw container fallback response:", response.text);
    throw new Error(
      `Gemini returned invalid container fallback JSON for ${displayName}`,
    );
  }

  return {
    tblContainer: Array.isArray(parsed?.tblContainer)
      ? parsed.tblContainer
      : [],
    containerTotal:
      parsed?.containerTotal && typeof parsed.containerTotal === "object"
        ? parsed.containerTotal
        : {},
  };
}

async function extractInvoiceNoFallbackFromGemini(
  fetchedFile,
  workItem,
  index,
  totalItems,
) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;

  const response = await withRetry(
    async () => {
      setReadingStatus({
        status: "running",
        stage: "extracting_invoice_no_fallback",
        progress: Math.min(
          84 + Math.floor((index / Math.max(totalItems, 1)) * 8),
          97,
        ),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Retrying invoice number extraction for ${displayName}`,
        error: null,
      });

      const contents = [
        buildInvoiceNoOnlyPrompt(workItem),
        createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
      ];

      return await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Preserve identifier text exactly as printed.",
          responseMimeType: "application/json",
          responseJsonSchema: INVOICE_NO_ONLY_SCHEMA,
        },
      });
    },
    {
      label: `invoiceNo fallback ${displayName}`,
      onRetry: (error, attempt, delayMs) => {
        setReadingStatus({
          status: "running",
          stage: "retrying_invoice_no_fallback",
          currentFileIndex: index + 1,
          totalFiles: totalItems,
          currentFileName: displayName,
          message: `Retrying invoice number fallback for ${displayName} (attempt ${attempt + 1}) after ${delayMs} ms`,
          error: error?.message || String(error),
        });
      },
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (jsonError) {
    console.error("Gemini raw invoiceNo fallback response:", response.text);
    throw new Error(
      `Gemini returned invalid invoiceNo fallback JSON for ${displayName}`,
    );
  }

  return {
    invoiceNo:
      parsed?.invoiceNo && typeof parsed.invoiceNo === "string"
        ? parsed.invoiceNo.trim()
        : null,
  };
}

function mergePromptTokensDetails(usageMetadataList = []) {
  const totals = new Map();

  for (const item of usageMetadataList) {
    const details = item?.usageMetadata?.promptTokensDetails || [];

    for (const detail of details) {
      const modality = detail?.modality || "UNKNOWN";
      const tokenCount = Number(detail?.tokenCount || 0);

      totals.set(modality, (totals.get(modality) || 0) + tokenCount);
    }
  }

  return [...totals.entries()].map(([modality, tokenCount]) => ({
    modality,
    tokenCount,
  }));
}

function buildUsageMetadata(usageMetadataList = []) {
  if (!usageMetadataList.length) {
    return {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      promptTokensDetails: [],
      thoughtsTokenCount: 0,
      pdfName: null,
      startPage: null,
      endPage: null,
      totalPages: null,
      wasChunked: false,
    };
  }

  // If only one file/chunk was processed, return exactly the flat shape you want
  if (usageMetadataList.length === 1) {
    const item = usageMetadataList[0];
    const meta = item?.usageMetadata || {};

    return {
      promptTokenCount: Number(meta.promptTokenCount || 0),
      candidatesTokenCount: Number(meta.candidatesTokenCount || 0),
      totalTokenCount: Number(meta.totalTokenCount || 0),
      promptTokensDetails: Array.isArray(meta.promptTokensDetails)
        ? meta.promptTokensDetails
        : [],
      thoughtsTokenCount: Number(meta.thoughtsTokenCount || 0),
      pdfName: item.originalFileName || item.file || null,
      startPage: item.startPage ?? null,
      endPage: item.endPage ?? null,
      totalPages: item.totalPages ?? null,
      wasChunked: !!item.wasChunked,
    };
  }

  // If multiple files/chunks were processed, aggregate token counts
  return {
    promptTokenCount: usageMetadataList.reduce(
      (sum, item) => sum + Number(item?.usageMetadata?.promptTokenCount || 0),
      0,
    ),
    candidatesTokenCount: usageMetadataList.reduce(
      (sum, item) =>
        sum + Number(item?.usageMetadata?.candidatesTokenCount || 0),
      0,
    ),
    totalTokenCount: usageMetadataList.reduce(
      (sum, item) => sum + Number(item?.usageMetadata?.totalTokenCount || 0),
      0,
    ),
    promptTokensDetails: mergePromptTokensDetails(usageMetadataList),
    thoughtsTokenCount: usageMetadataList.reduce(
      (sum, item) => sum + Number(item?.usageMetadata?.thoughtsTokenCount || 0),
      0,
    ),
    pdfName: uniqueNonEmpty(
      usageMetadataList.map((item) => item.originalFileName || item.file),
    ).join(", "),
    startPage: null,
    endPage: null,
    totalPages: null,
    wasChunked: usageMetadataList.some((item) => !!item.wasChunked),
  };
}

function normalizeVesselVoyageFields(data = {}) {
  const out = { ...data };

  const rawVessel = String(out.rawVesselText || "").trim();
  const rawVoyage = String(out.rawVoyageText || "").trim();
  const vesselName = String(out.vesselName || "").trim();
  const voyageName = String(out.voyageName || "").trim();
  const combined = String(out.rawVesselOrVoyageText || "").trim();

  if (!out.vesselName && rawVessel) {
    out.vesselName = rawVessel;
  }

  if (!out.voyageName && rawVoyage) {
    out.voyageName = rawVoyage;
  }

  if ((!out.vesselName || !out.voyageName) && combined.includes("/")) {
    const [left, right] = combined.split("/").map((s) => s.trim());

    if (!out.vesselName && left) out.vesselName = left;
    if (!out.voyageName && right) out.voyageName = right;
  }

  return out;
}

async function extractSingleChunkFromGemini(
  fetchedFile,
  workItem,
  index,
  totalItems,
) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;

  const prompt = workItem.wasChunked
    ? buildChunkTaskPrompt(workItem)
    : buildTaskPrompt([workItem.originalFileName || workItem.displayName]);

  const response = await withRetry(
    async () => {
      setReadingStatus({
        status: "running",
        stage: "generating_content",
        progress: Math.min(
          75 + Math.floor((index / Math.max(totalItems, 1)) * 18),
          94,
        ),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Extracting data from ${displayName}`,
        error: null,
      });

      const contents = [
        prompt,
        createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
      ];

      return await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Prefer null over guessing. Follow the schema exactly.",
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_SCHEMA,
        },
      });
    },
    {
      label: `generate content ${displayName}`,
      onRetry: (error, attempt, delayMs) => {
        setReadingStatus({
          status: "running",
          stage: "retrying_generate_content",
          currentFileIndex: index + 1,
          totalFiles: totalItems,
          currentFileName: displayName,
          message: `Retrying extraction for ${displayName} (attempt ${attempt + 1}) after ${delayMs} ms`,
          error: error?.message || String(error),
        });
      },
    },
  );

  let parsed;

  try {
    parsed = JSON.parse(response.text);
  } catch (jsonError) {
    console.error("Gemini raw response:", response.text);
    throw new Error(`Gemini returned invalid JSON for ${displayName}`);
  }

  parsed = normalizeResultShape(parsed);
  parsed = normalizeVesselVoyageFields(parsed);

  // Focused fallback for invoice number
  let invoiceFallback = null;

  try {
    invoiceFallback = await extractInvoiceNoFallbackFromGemini(
      fetchedFile,
      workItem,
      index,
      totalItems,
    );
  } catch (invoiceFallbackError) {
    console.error(
      `InvoiceNo fallback failed for ${displayName}:`,
      invoiceFallbackError,
    );
  }

  parsed.invoiceNo = pickBestInvoiceNo([
    { value: workItem.textInvoiceCandidate, source: "pdf_text" },
    { value: invoiceFallback?.invoiceNo, source: "gemini_invoice_fallback" },
    { value: parsed.invoiceNo, source: "gemini_main" },
  ]);

  // Focused fallback for container table
  if (!Array.isArray(parsed.tblContainer) || parsed.tblContainer.length === 0) {
    try {
      const fallback = await extractContainerFallbackFromGemini(
        fetchedFile,
        workItem,
        index,
        totalItems,
      );

      if (
        Array.isArray(fallback.tblContainer) &&
        fallback.tblContainer.length
      ) {
        parsed.tblContainer = dedupeObjectArray([
          ...(parsed.tblContainer || []),
          ...fallback.tblContainer,
        ]);
      }

      if (
        (!parsed.containerTotal ||
          Object.keys(parsed.containerTotal).length === 0) &&
        fallback.containerTotal &&
        typeof fallback.containerTotal === "object"
      ) {
        parsed.containerTotal = fallback.containerTotal;
      }
    } catch (fallbackError) {
      console.error(
        `Container fallback failed for ${displayName}:`,
        fallbackError,
      );
    }
  }

  return {
    parsed,
    usageMetadata: response.usageMetadata || {},
  };
}

module.exports = {
  extractPdfData: async (req, res) => {
    try {
      if (readingStatus.status === "running") {
        return res.status(409).json({
          success: false,
          error: "Another PDF extraction is already running",
          readingStatus,
        });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          error: "GEMINI_API_KEY is not configured",
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
        fileState: null,
        message: "PDF extraction started",
        data: null,
        error: null,
      });

      res.status(202).json({
        success: true,
        message: "PDF extraction started",
        readingStatus,
      });

      (async () => {
        const uploadedGeminiNames = [];

        try {
          setReadingStatus({
            status: "running",
            stage: "validating",
            progress: 5,
            totalFiles: files.length,
            message: "Validating uploaded PDF files",
            error: null,
          });

          const workItems = await buildWorkItems(files);

          setReadingStatus({
            status: "running",
            stage: "preparing_chunks",
            progress: 8,
            totalFiles: workItems.length,
            currentFileIndex: null,
            currentFileName: null,
            message: `Prepared ${workItems.length} processing unit(s) from ${files.length} uploaded PDF file(s)`,
            error: null,
          });

          let mergedResult = normalizeResultShape({});
          const usageMetadataList = [];

          for (let i = 0; i < workItems.length; i++) {
            const workItem = workItems[i];

            const { fetchedFile, uploadedName } = await uploadAndWaitForFile(
              workItem,
              i,
              workItems.length,
            );

            uploadedGeminiNames.push(uploadedName);

            const { parsed, usageMetadata } =
              await extractSingleChunkFromGemini(
                fetchedFile,
                workItem,
                i,
                workItems.length,
              );

            mergedResult = mergeExtractionResults(mergedResult, parsed);

            usageMetadataList.push({
              file: workItem.displayName,
              originalFileName: workItem.originalFileName,
              pdfName: workItem.originalFileName,
              pdfPages: workItem.totalPages,
              partIndex: workItem.partIndex,
              partCount: workItem.partCount,
              startPage: workItem.startPage,
              endPage: workItem.endPage,
              totalPages: workItem.totalPages,
              wasChunked: workItem.wasChunked,
              usageMetadata,
            });
          }

          mergedResult = normalizeResultShape(mergedResult);
          const finalUsageMetadata = buildUsageMetadata(usageMetadataList);

          setReadingStatus({
            status: "completed",
            stage: "completed",
            progress: 100,
            currentFileIndex: workItems.length || null,
            totalFiles: workItems.length,
            currentFileName: null,
            fileState: null,
            message: "PDF data extracted successfully",
            data: {
              ...mergedResult,
              pdfFiles: buildPdfFilesSummary(workItems),
              usageMetadata: finalUsageMetadata,
              processingInfo: {
                originalUploadedFiles: files.length,
                processedUnits: workItems.length,
                chunkedFiles: uniqueNonEmpty(
                  workItems
                    .filter((w) => w.wasChunked)
                    .map((w) => w.originalFileName),
                ),
              },
            },
            error: null,
          });
        } catch (error) {
          console.error("Error extracting PDF data:", error);

          setReadingStatus({
            status: "failed",
            stage: "failed",
            progress: 100,
            currentFileName: null,
            fileState: null,
            message: error.message || "Failed to extract PDF data",
            error: error.message || "Failed to extract PDF data",
            data: null,
          });
        } finally {
          await deleteGeminiFiles(uploadedGeminiNames);
        }
      })();
    } catch (error) {
      console.error("Error starting PDF extraction:", error);

      setReadingStatus({
        status: "failed",
        stage: "failed",
        progress: 100,
        currentFileName: null,
        fileState: null,
        message: error.message || "Failed to start PDF extraction",
        error: error.message || "Failed to start PDF extraction",
        data: null,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to start PDF extraction",
      });
    }
  },

  getPdfExtractionStatus: async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        readingStatus,
      });
    } catch (error) {
      console.error("Error getting PDF extraction status:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get reading status",
      });
    }
  },
};
// today back Up