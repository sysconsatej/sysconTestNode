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
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const BIG_PDF_BYTES = Number(process.env.BIG_PDF_BYTES || 15 * 1024 * 1024);
const BIG_PDF_PAGE_THRESHOLD = Number(process.env.BIG_PDF_PAGE_THRESHOLD || 25);
const PDF_CHUNK_PAGE_COUNT = Number(process.env.PDF_CHUNK_PAGE_COUNT || 12);
const GEMINI_GENERATE_RETRIES = Number(process.env.GEMINI_GENERATE_RETRIES || 3);
const GEMINI_RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS || 3000);
const GEMINI_FILE_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_POLL_INTERVAL_MS || 2000,
);
const GEMINI_FILE_PROCESSING_TIMEOUT_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_TIMEOUT_MS || 15 * 60 * 1000,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TARGET_FIELDS = [
  "consignorOrShipper",
  "consignee",
  "notify",
  "vessel",
  "voyage",
  "placeOfReceipt",
  "portOfLoading",
  "placeOfDelivery",
  "portOfDischarge",
  "marksAndNumbers",
  "descriptionOfGoods",
  "weight",
  "measurement",
  "grossWeight",
  "netWeight",
  "shippedOnBoardDate",
  "freightPayableAt",
  "numberOfOriginalMtd",
  "placeAndDateOfIssue",
  "forCompanyName",
  "mtdNo",
  "reportType",
];

const NUMBER_WORDS = new Set([
  "ONE",
  "TWO",
  "THREE",
  "FOUR",
  "FIVE",
  "SIX",
  "SEVEN",
  "EIGHT",
  "NINE",
  "TEN",
]);

let readingStatus = {
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

function normalizeWhitespace(value) {
  if (!isMeaningfulValue(value)) return null;
  return String(value)
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function uniqueNonEmpty(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeResultShape(data = {}) {
  const out = {};
  TARGET_FIELDS.forEach((key) => {
    out[key] = data?.[key] ?? null;
  });
  return out;
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
    existing.chunkCount = Math.max(existing.chunkCount || 1, item.partCount || 1);
  }

  return [...map.values()];
}

async function extractTextFromPdfBuffer(buffer) {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) return "";
    const parsed = await pdfParse(buffer);
    return String(parsed?.text || "");
  } catch (error) {
    console.error("extractTextFromPdfBuffer failed:", error?.message || error);
    return "";
  }
}

function cleanIdentifier(value) {
  if (!isMeaningfulValue(value)) return null;
  return String(value)
    .replace(/\u00A0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^[\s:=#|._-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeMtdNo(value) {
  const s = cleanIdentifier(value);
  if (!s) return false;
  if (s.length < 6 || s.length > 80) return false;
  if (/^mtd\s*no/i.test(s)) return false;
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return false;
  return /^[A-Za-z0-9/._\- ]+$/.test(s);
}

function normalizeLabelToken(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_ALIASES = {
  consignorOrShipper: [
    "CONSIGNOR",
    "SHIPPER",
    "SHIPPER EXPORTER",
    "SHIPPER NAME ADDRESS",
    "SHIPPER NAME AND ADDRESS",
    "EXPORTER",
  ],
  consignee: [
    "CONSIGNEE",
    "CONSIGNEE IF TO ORDER SO INDICATE",
    "TO ORDER",
  ],
  notify: [
    "NOTIFY",
    "NOTIFY ADDRESS",
    "NOTIFY PARTY",
  ],
  vessel: [
    "VESSEL",
    "VESSEL NAME",
    "MV",
    "MOTHER VESSEL",
  ],
  voyage: [
    "VOYAGE",
    "VOYAGE NO",
    "VOYAGE NUMBER",
    "VIA",
    "SERVICE VIA",
  ],
  placeOfReceipt: [
    "PLACE OF RECEIPT",
    "PLACE DATE OF RECEIPT",
    "RECEIVED AT",
  ],
  portOfLoading: [
    "PORT OF LOADING",
    "POL",
    "PORT OF LOADING TAKING IN CHARGE",
  ],
  placeOfDelivery: [
    "PLACE OF DELIVERY",
    "FINAL PLACE OF DELIVERY",
    "FPD",
  ],
  portOfDischarge: [
    "PORT OF DISCHARGE",
    "POD",
    "DISCHARGE PORT",
  ],
  marksAndNumbers: [
    "MARKS AND NUMBERS",
    "MARKS NUMBERS",
    "MARKS",
  ],
  descriptionOfGoods: [
    "DESCRIPTION OF GOODS",
    "PARTICULARS FURNISHED BY MERCHANT",
    "DESCRIPTION",
    "SAID TO CONTAIN",
  ],
  weight: [
    "WEIGHT",
    "TOTAL WEIGHT",
  ],
  measurement: [
    "MEASUREMENT",
    "CBM",
    "CFT",
    "TOTAL WEIGHT MEASUREMENT",
  ],
  grossWeight: ["GROSS WEIGHT"],
  netWeight: ["NET WEIGHT"],
  shippedOnBoardDate: [
    "SHIPPED ON BOARD DATE",
    "ON BOARD DATE",
    "SHIPPED DATE",
  ],
  freightPayableAt: [
    "FREIGHT PAYABLE AT",
    "FREIGHT PAYABLE",
    "FREIGHT PAYABLE PLACE",
  ],
  numberOfOriginalMtd: [
    "NUMBER OF ORIGINAL MTD",
    "NUMBER OF ORIGINAL MTD S",
    "NO OF ORIGINAL MTD",
    "NO OF ORIGINAL MTDS",
  ],
  placeAndDateOfIssue: [
    "PLACE DATE OF ISSUE",
    "PLACE AND DATE OF ISSUE",
    "PLACE OF ISSUE DATE OF ISSUE",
  ],
  forCompanyName: ["FOR"],
  mtdNo: ["MTD NO"],
  reportType: ["DRAFT", "FINAL"],
};

const ALL_LABELS = Object.values(FIELD_ALIASES).flat();

function isLabelOnlyValue(field, value) {
  if (!isMeaningfulValue(value)) return true;

  const normalized = normalizeLabelToken(value);
  if (!normalized) return true;

  const aliases = (FIELD_ALIASES[field] || []).map(normalizeLabelToken);

  if (aliases.includes(normalized)) return true;

  if (field === "vessel" && (normalized === "VESSEL" || normalized === "VESSEL NAME")) {
    return true;
  }

  if (field === "voyage" && (normalized === "VOYAGE" || normalized === "VOYAGE NO")) {
    return true;
  }

  if (field === "reportType" && !["DRAFT", "FINAL"].includes(normalized)) {
    return true;
  }

  return false;
}

function cleanBusinessField(field, value) {
  const normalized = normalizeWhitespace(value);
  if (!isMeaningfulValue(normalized)) return null;
  if (isLabelOnlyValue(field, normalized)) return null;
  return normalized;
}

function normalizeReportType(value) {
  const v = normalizeLabelToken(value);
  if (v.includes("DRAFT")) return "DRAFT";
  if (v.includes("FINAL")) return "FINAL";
  return null;
}

function getLines(rawText = "") {
  return String(rawText || "")
    .replace(/\u00A0/g, " ")
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

function looksLikeStopLabel(line) {
  const normalized = normalizeLabelToken(line);
  if (!normalized) return false;

  return ALL_LABELS.some((alias) => {
    const a = normalizeLabelToken(alias);
    return normalized === a || normalized.startsWith(`${a} `);
  });
}

function collectFollowingBlock(lines, startIndex, options = {}) {
  const { maxLines = 8, allowBlankStops = true } = options;
  const buffer = [];

  for (let i = startIndex + 1; i < lines.length && buffer.length < maxLines; i++) {
    const line = lines[i];

    if (!line) {
      if (allowBlankStops && buffer.length > 0) break;
      continue;
    }

    if (looksLikeStopLabel(line)) break;

    buffer.push(line);
  }

  return normalizeWhitespace(buffer.join(" "));
}

function findFieldFromLabeledLines(lines, aliases = [], options = {}) {
  const { maxLines = 8, allowInlineValue = true } = options;
  const normalizedAliases = aliases.map(normalizeLabelToken);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalizedLine = normalizeLabelToken(line);

    for (const alias of normalizedAliases) {
      if (
        allowInlineValue &&
        normalizedLine.startsWith(alias) &&
        normalizedLine !== alias
      ) {
        const inline = normalizeWhitespace(
          line
            .replace(
              new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
              "",
            )
            .replace(/^[:\- ]+/, ""),
        );
        if (inline) return inline;
      }

      if (normalizedLine === alias) {
        const block = collectFollowingBlock(lines, i, { maxLines });
        if (block) return block;
      }
    }
  }

  return null;
}

function extractDescriptionBlock(text = "") {
  return firstNonEmptyMatch(text, [
    /(?:DESCRIPTION\s+OF\s+GOODS|PARTICULARS\s+FURNISHED\s+BY\s+MERCHANT)\s*[:\n]*([\s\S]{10,2500}?)(?=\b(?:TOTAL\s+WEIGHT|MEASUREMENT|GROSS\s+WEIGHT|NET\s+WEIGHT|NUMBER\s+OF\s+ORIGINAL|FREIGHT\s+PAYABLE\s+AT|PLACE\s*&\s*DATE\s+OF\s+ISSUE|PLACE\s+AND\s+DATE\s+OF\s+ISSUE|SHIPPED\s+ON\s+BOARD\s+DATE)\b)/i,
  ]);
}

function extractMarksBlock(text = "") {
  return firstNonEmptyMatch(text, [
    /(?:MARKS\s+AND\s+NUMBERS|MARKS\s*&\s*NUMBERS|MARKS)\s*[:\n]*([\s\S]{1,600}?)(?=\b(?:DESCRIPTION\s+OF\s+GOODS|PARTICULARS\s+FURNISHED\s+BY\s+MERCHANT|TOTAL\s+WEIGHT|MEASUREMENT|GROSS\s+WEIGHT|NET\s+WEIGHT)\b)/i,
  ]);
}

function extractDeterministicFieldsFromText(rawText = "") {
  const text = String(rawText || "");
  const lines = getLines(text);

  const reportType = /\bDRAFT\b/i.test(text)
    ? "DRAFT"
    : /\bFINAL\b/i.test(text)
      ? "FINAL"
      : null;

  const direct = {
    mtdNo: firstNonEmptyMatch(text, [
      /MTD\s*NO\.?\s*:?\s*([A-Za-z0-9/._\- ]{6,80})/i,
    ]),
    grossWeight: firstNonEmptyMatch(text, [
      /GROSS\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /GROSS\s+WEIGHT\s*\n\s*([^\n\r]{2,80})/i,
    ]),
    netWeight: firstNonEmptyMatch(text, [
      /NET\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /NET\s+WEIGHT\s*\n\s*([^\n\r]{2,80})/i,
    ]),
    weight: firstNonEmptyMatch(text, [
      /(?:^|\n)WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /(?:^|\n)TOTAL\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
    ]),
    measurement: firstNonEmptyMatch(text, [
      /MEASUREMENT\s*:?\s*([^\n\r]{2,80})/i,
      /MEASUREMENT\s*\n\s*([^\n\r]{2,80})/i,
      /(?:^|\n)([0-9., ]+\s*(?:CBM|CFT))\b/i,
    ]),
    freightPayableAt: firstNonEmptyMatch(text, [
      /FREIGHT\s+PAYABLE\s+AT\s*:?\s*([^\n\r]{2,120})/i,
      /FREIGHT\s+PAYABLE\s+AT\s*\n\s*([^\n\r]{2,120})/i,
    ]),
    numberOfOriginalMtd: firstNonEmptyMatch(text, [
      /NUMBER\s+OF\s+ORIGINAL\s+MTD\(?S?\)?\s*:?\s*([^\n\r]{1,60})/i,
      /NUMBER\s+OF\s+ORIGINAL\s+MTD\(?S?\)?\s*\n\s*([^\n\r]{1,60})/i,
      /NO\.?\s+OF\s+ORIGINAL\s+MTD\s*:?\s*([^\n\r]{1,60})/i,
    ]),
    shippedOnBoardDate: firstNonEmptyMatch(text, [
      /SHIPPED\s+ON\s+BOARD\s+DATE\s*:?\s*([^\n\r]{2,80})/i,
      /SHIPPED\s+ON\s+BOARD\s+DATE\s*\n\s*([^\n\r]{2,80})/i,
    ]),
    placeAndDateOfIssue: firstNonEmptyMatch(text, [
      /PLACE\s*&\s*DATE\s+OF\s+ISSUE\s*:?\s*([^\n\r]{2,160})/i,
      /PLACE\s+AND\s+DATE\s+OF\s+ISSUE\s*:?\s*([^\n\r]{2,160})/i,
      /PLACE\s*&\s*DATE\s+OF\s+ISSUE\s*\n\s*([^\n\r]{2,160})/i,
      /PLACE\s+AND\s+DATE\s+OF\s+ISSUE\s*\n\s*([^\n\r]{2,160})/i,
    ]),
    forCompanyName: firstNonEmptyMatch(text, [
      /(?:^|\n)For\s+([A-Za-z0-9&.,'()\/\- ]{3,120})(?:\n|$)/im,
    ]),
    marksAndNumbers: extractMarksBlock(text),
    descriptionOfGoods: extractDescriptionBlock(text),
  };

  const block = {
    consignorOrShipper: findFieldFromLabeledLines(lines, FIELD_ALIASES.consignorOrShipper, {
      maxLines: 7,
    }),
    consignee: findFieldFromLabeledLines(lines, FIELD_ALIASES.consignee, {
      maxLines: 7,
    }),
    notify: findFieldFromLabeledLines(lines, FIELD_ALIASES.notify, {
      maxLines: 7,
    }),
    vessel: findFieldFromLabeledLines(lines, FIELD_ALIASES.vessel, {
      maxLines: 2,
    }),
    voyage: findFieldFromLabeledLines(lines, FIELD_ALIASES.voyage, {
      maxLines: 2,
    }),
    placeOfReceipt: findFieldFromLabeledLines(lines, FIELD_ALIASES.placeOfReceipt, {
      maxLines: 2,
    }),
    portOfLoading: findFieldFromLabeledLines(lines, FIELD_ALIASES.portOfLoading, {
      maxLines: 2,
    }),
    placeOfDelivery: findFieldFromLabeledLines(lines, FIELD_ALIASES.placeOfDelivery, {
      maxLines: 2,
    }),
    portOfDischarge: findFieldFromLabeledLines(lines, FIELD_ALIASES.portOfDischarge, {
      maxLines: 2,
    }),
  };

  return {
    ...block,
    ...direct,
    reportType,
  };
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
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    consignorOrShipper: S.str(
      "Full consignor/shipper block exactly as printed. This may appear under labels such as CONSIGNOR, SHIPPER, SHIPPER/EXPORTER, SHIPPER NAME & ADDRESS, EXPORTER, or similar.",
    ),
    consignee: S.str(
      "Full consignee block exactly as printed. This may appear under labels such as CONSIGNEE, CONSIGNEE (If TO ORDER so indicate), TO ORDER, or similar.",
    ),
    notify: S.str(
      "Full notify block exactly as printed. This may appear under labels such as NOTIFY, NOTIFY ADDRESS, NOTIFY PARTY, or similar. Prefer the main notify block, not a 2nd notify line from cargo text.",
    ),
    vessel: S.str(
      "Vessel name exactly as printed. This may appear under labels such as VESSEL, VESSEL NAME, MV, MOTHER VESSEL, or similar. If the field is blank, return null and do not return the label itself.",
    ),
    voyage: S.str(
      "Voyage value exactly as printed. This may appear under labels such as VOYAGE, VOYAGE NO, VIA, SERVICE/VIA, or similar when it is clearly the voyage/service code.",
    ),
    placeOfReceipt: S.str(
      "Place of receipt exactly as printed. This may appear under labels such as PLACE OF RECEIPT, PLACE & DATE OF RECEIPT, RECEIVED AT, or similar.",
    ),
    portOfLoading: S.str(
      "Port of loading exactly as printed. This may appear under labels such as PORT OF LOADING, POL, or similar.",
    ),
    placeOfDelivery: S.str(
      "Place of delivery exactly as printed. This may appear under labels such as PLACE OF DELIVERY, FINAL PLACE OF DELIVERY, FPD, or similar.",
    ),
    portOfDischarge: S.str(
      "Port of discharge exactly as printed. This may appear under labels such as PORT OF DISCHARGE, POD, DISCHARGE PORT, or similar.",
    ),
    marksAndNumbers: S.str(
      "Marks and numbers text exactly as printed. This may appear under labels such as MARKS AND NUMBERS, MARKS & NUMBERS, MARKS, or similar.",
    ),
    descriptionOfGoods: S.str(
      "Description of goods exactly as printed. This may appear under labels such as DESCRIPTION OF GOODS, PARTICULARS FURNISHED BY MERCHANT, DESCRIPTION, SAID TO CONTAIN, or similar cargo description area.",
    ),
    weight: S.str(
      "Main printed weight value if a generic WEIGHT or TOTAL WEIGHT exists. If only gross and net are clearly printed, return the most representative printed weight field from the body or null.",
    ),
    measurement: S.str(
      "Measurement exactly as printed, such as CBM/CFT or total measurement.",
    ),
    grossWeight: S.str("Gross weight exactly as printed."),
    netWeight: S.str("Net weight exactly as printed."),
    shippedOnBoardDate: S.str(
      "Shipped on board date exactly as printed. If the label exists but the value is blank, return null.",
    ),
    freightPayableAt: S.str("Freight payable at exactly as printed."),
    numberOfOriginalMtd: S.str(
      "Number of original MTDs exactly as printed. This may appear as NUMBER OF ORIGINAL MTD, NUMBER OF ORIGINAL MTD(S), NO OF ORIGINAL MTD, No. of Original MTD, etc.",
    ),
    placeAndDateOfIssue: S.str(
      "Place and date of issue exactly as printed. If the label exists but the value is blank, return null.",
    ),
    forCompanyName: S.str(
      "Company name appearing after the word For near the signatory/footer, such as 'For SMARTBOXX CONTAINERS PVT LTD'. Extract only the company name part.",
    ),
    mtdNo: S.str("MTD number exactly as printed."),
    reportType: S.str(
      "Return DRAFT when the document explicitly indicates draft, FINAL when it explicitly indicates final or finalised, otherwise null.",
    ),
  },
  required: [],
};

const FALLBACK_SCHEMA = EXTRACTION_SCHEMA;

function buildTaskPrompt(fileNames = []) {
  return `
You are a high-accuracy BL / MTD PDF extraction engine.

Extract data from the provided PDF files and return ONLY valid JSON matching the schema.

The same business field can appear under different labels in different PDFs.
You must extract the correct business field even when label wording differs.

Business field mapping rules:
1. consignorOrShipper:
   - Can appear as CONSIGNOR, SHIPPER, SHIPPER/EXPORTER, SHIPPER NAME & ADDRESS, EXPORTER, etc.
2. consignee:
   - Can appear as CONSIGNEE, CONSIGNEE (IF TO ORDER SO INDICATE), TO ORDER party block, etc.
3. notify:
   - Can appear as NOTIFY, NOTIFY ADDRESS, NOTIFY PARTY, 2ND NOTIFY PARTY, etc.
   - Prefer the main notify block only.
4. vessel:
   - Can appear as VESSEL, VESSEL NAME, MV, MOTHER VESSEL, etc.
   - If blank, return null and do not return the label text.
5. voyage:
   - Can appear as VOYAGE, VOYAGE NO, VIA, SERVICE/VIA, etc. when clearly the voyage/service code.
6. placeOfReceipt:
   - Can appear as PLACE OF RECEIPT, PLACE & DATE OF RECEIPT, RECEIVED AT, etc.
7. portOfLoading:
   - Can appear as PORT OF LOADING, POL, etc.
8. placeOfDelivery:
   - Can appear as PLACE OF DELIVERY, FINAL PLACE OF DELIVERY, FPD, etc.
9. portOfDischarge:
   - Can appear as PORT OF DISCHARGE, POD, DISCHARGE PORT, etc.
10. marksAndNumbers:
   - Can appear as MARKS AND NUMBERS, MARKS & NUMBERS, MARKS, etc.
11. descriptionOfGoods:
   - Can appear as DESCRIPTION OF GOODS, PARTICULARS FURNISHED BY MERCHANT, DESCRIPTION, SAID TO CONTAIN, cargo description block, etc.
12. weight:
   - Extract a generic weight if a generic weight field exists.
13. measurement:
   - Extract CBM / CFT / measurement field when printed.
14. shippedOnBoardDate:
   - Can appear as SHIPPED ON BOARD DATE, ON BOARD DATE, SHIPPED DATE, etc.
15. freightPayableAt:
   - Can appear as FREIGHT PAYABLE AT, FREIGHT PAYABLE PLACE, etc.
16. numberOfOriginalMtd:
   - Can appear as NUMBER OF ORIGINAL MTD, NUMBER OF ORIGINAL MTD(S), NO OF ORIGINAL MTD, etc.
17. placeAndDateOfIssue:
   - Can appear as PLACE & DATE OF ISSUE, PLACE AND DATE OF ISSUE, etc.
18. forCompanyName:
   - Extract the company name after the word 'For' in the footer/signatory area.
19. mtdNo:
   - Extract MTD No exactly as printed.
20. reportType:
   - Return DRAFT if the document explicitly says DRAFT.
   - Return FINAL if the document explicitly says FINAL.
   - Otherwise return null.

General rules:
- Do not guess.
- Preserve business values exactly as printed.
- Do not convert letters to numbers or numbers to letters.
- If the field label exists but the value is blank, return null.
- Never return just the label as the value.
- If layout is irregular, infer the field from nearby label-value relationship and business meaning.
- Combine multi-line address/value blocks into a clean single string with spaces.
- Return ONLY JSON matching the schema.

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
- If a field is not visible in this chunk, return null for that chunk.
- Do not assume values from unseen pages.
- The application will merge chunk outputs later.
`;
}

function buildFallbackPrompt(workItem) {
  const fileName = workItem.originalFileName || workItem.displayName || "N/A";

  return `
You are a high-accuracy BL / MTD PDF extraction engine.

Extract the same target business fields again, carefully.
This is a fallback extraction pass.

Rules:
- Return only valid JSON matching the schema.
- Do not guess.
- Never return the label itself as the value.
- If a field is blank, return null.
- Prefer the main notify block, not a 2nd notify line from cargo text.
- Preserve exact business text and identifiers.

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
  const safeBaseName = String(originalName || "upload.pdf").replace(/\.pdf$/i, "");
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
    const rawText = await extractTextFromPdfBuffer(chunkBuffer);
    const deterministicFields = extractDeterministicFieldsFromText(rawText);
    const partIndex = Math.floor(start / chunkPageCount) + 1;
    const displayName = `${safeBaseName}__part_${partIndex}_of_${partCount}.pdf`;
    const tempPath = path.join(
      os.tmpdir(),
      `${Date.now()}-${crypto.randomUUID()}-${displayName}`,
    );

    await fs.writeFile(tempPath, chunkBuffer);

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
      originalSizeBytes: buffer.length,
      rawText,
      deterministicFields,
    });
  }

  return items;
}

async function buildWorkItems(files) {
  const workItems = [];

  for (const file of files) {
    const displayName = file?.name || "upload.pdf";
    const buffer = await getFileBuffer(file);

    if (!buffer) {
      throw new Error(`Could not read uploaded file: ${displayName}`);
    }

    const rawText = await extractTextFromPdfBuffer(buffer);
    const deterministicFields = extractDeterministicFieldsFromText(rawText);

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
      rawText,
      deterministicFields,
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
      progress: Math.min(10 + Math.floor((index / Math.max(totalItems, 1)) * 25), 35),
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
          progress: Math.min(20 + Math.floor((index / Math.max(totalItems, 1)) * 25), 45),
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
      { label: `get uploaded file ${displayName}` },
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
      const loopProgress = Math.min(loopProgressBase + Math.min(pollCounter * 2, 12), 70);

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
        { label: `poll file ${displayName}` },
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

    return { fetchedFile, uploadedName };
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

async function extractFallbackFromGemini(fetchedFile, workItem, index, totalItems) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;

  const response = await withRetry(
    async () => {
      setReadingStatus({
        status: "running",
        stage: "extracting_fallback",
        progress: Math.min(84 + Math.floor((index / Math.max(totalItems, 1)) * 8), 97),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Retrying extraction for ${displayName}`,
        error: null,
      });

      return await ai.models.generateContent({
        model: MODEL,
        contents: [
          buildFallbackPrompt(workItem),
          createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
        ],
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Preserve business values exactly as printed. Never return label text as the value.",
          responseMimeType: "application/json",
          responseJsonSchema: FALLBACK_SCHEMA,
        },
      });
    },
    {
      label: `fallback ${displayName}`,
      onRetry: (error, attempt, delayMs) => {
        setReadingStatus({
          status: "running",
          stage: "retrying_fallback",
          currentFileIndex: index + 1,
          totalFiles: totalItems,
          currentFileName: displayName,
          message: `Retrying fallback for ${displayName} (attempt ${attempt + 1}) after ${delayMs} ms`,
          error: error?.message || String(error),
        });
      },
    },
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (jsonError) {
    console.error("Gemini raw fallback response:", response.text);
    throw new Error(`Gemini returned invalid fallback JSON for ${displayName}`);
  }

  return {
    data: normalizeResultShape(parsed),
    usageMetadata: response?.usageMetadata || {},
  };
}

function pickBestValue(candidates = [], validator = () => true) {
  const prepared = candidates
    .map((item) =>
      typeof item === "string" ? { value: item, source: "unknown" } : item,
    )
    .map((item) => ({
      ...item,
      cleaned: normalizeWhitespace(item.value),
    }))
    .filter((item) => item.cleaned && validator(item.cleaned));

  if (!prepared.length) return null;

  prepared.sort((a, b) => {
    const score = (item) => {
      let total = 0;
      if (item.source === "pdf_text") total += 100;
      if (item.source === "gemini_fallback") total += 25;
      if (item.source === "gemini_main") total += 10;
      if (/[A-Za-z]/.test(item.cleaned)) total += 3;
      if (/\d/.test(item.cleaned)) total += 3;
      if (/[\/\-]/.test(item.cleaned)) total += 2;
      return total;
    };

    return score(b) - score(a);
  });

  return prepared[0].cleaned;
}

function sanitizeResult(data = {}) {
  const out = normalizeResultShape(data);

  TARGET_FIELDS.forEach((field) => {
    if (field === "reportType") {
      out[field] = normalizeReportType(out[field]);
      return;
    }

    if (field === "mtdNo") {
      out[field] = looksLikeMtdNo(out[field]) ? cleanIdentifier(out[field]) : null;
      return;
    }

    out[field] = cleanBusinessField(field, out[field]);
  });

  if (!out.weight) {
    out.weight = out.grossWeight || out.netWeight || null;
  }

  if (
    !out.numberOfOriginalMtd &&
    out.freightPayableAt &&
    NUMBER_WORDS.has(String(out.freightPayableAt).toUpperCase())
  ) {
    out.numberOfOriginalMtd = out.freightPayableAt;
    out.freightPayableAt = null;
  }

  if (
    !out.placeAndDateOfIssue &&
    out.numberOfOriginalMtd &&
    !NUMBER_WORDS.has(String(out.numberOfOriginalMtd).toUpperCase()) &&
    /[A-Za-z]/.test(String(out.numberOfOriginalMtd)) &&
    out.freightPayableAt &&
    NUMBER_WORDS.has(String(out.freightPayableAt).toUpperCase())
  ) {
    out.placeAndDateOfIssue = out.numberOfOriginalMtd;
    out.numberOfOriginalMtd = out.freightPayableAt;
    out.freightPayableAt = null;
  }

  return out;
}

function applyDeterministicFallback(main = {}, deterministic = {}, fallback = {}) {
  const out = {};

  TARGET_FIELDS.forEach((field) => {
    if (field === "mtdNo") {
      out.mtdNo = pickBestValue(
        [
          { value: deterministic?.mtdNo, source: "pdf_text" },
          { value: fallback?.mtdNo, source: "gemini_fallback" },
          { value: main?.mtdNo, source: "gemini_main" },
        ],
        looksLikeMtdNo,
      );
      return;
    }

    if (field === "reportType") {
      out.reportType =
        normalizeReportType(main?.reportType) ||
        normalizeReportType(fallback?.reportType) ||
        normalizeReportType(deterministic?.reportType) ||
        null;
      return;
    }

    out[field] =
      cleanBusinessField(field, main?.[field]) ||
      cleanBusinessField(field, fallback?.[field]) ||
      cleanBusinessField(field, deterministic?.[field]) ||
      null;
  });

  return sanitizeResult(out);
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

const GEMINI_PRICING = {
  "gemini-2.5-flash": {
    standard: { inputPer1M: 0.3, outputPer1M: 2.5 },
    batch: { inputPer1M: 0.15, outputPer1M: 1.25 },
  },
  "gemini-2.5-flash-lite": {
    standard: { inputPer1M: 0.1, outputPer1M: 0.4 },
    batch: { inputPer1M: 0.05, outputPer1M: 0.2 },
  },
};

function roundUSD(v) {
  return Number((v || 0).toFixed(8));
}

function getBillableCostFromUsage({
  usageMetadata = {},
  model = "gemini-2.5-flash",
  mode = "standard",
}) {
  const pricing = GEMINI_PRICING[model]?.[mode];
  if (!pricing) {
    throw new Error(`Pricing not configured for model=${model}, mode=${mode}`);
  }

  const promptTokenCount = Number(usageMetadata.promptTokenCount || 0);
  const candidatesTokenCount = Number(usageMetadata.candidatesTokenCount || 0);
  const thoughtsTokenCount = Number(usageMetadata.thoughtsTokenCount || 0);

  const inputTokens = promptTokenCount;
  const outputTokens = candidatesTokenCount + thoughtsTokenCount;
  const inputCostUSD = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCostUSD = (outputTokens / 1_000_000) * pricing.outputPer1M;

  return {
    inputTokens,
    outputTokens,
    thoughtsTokenCount,
    inputRatePer1M: pricing.inputPer1M,
    outputRatePer1M: pricing.outputPer1M,
    inputCostUSD: roundUSD(inputCostUSD),
    outputCostUSD: roundUSD(outputCostUSD),
    totalCostUSD: roundUSD(inputCostUSD + outputCostUSD),
  };
}

function buildUsageMetadata(usageMetadataList = []) {
  const pricingMode = (process.env.GEMINI_PRICING_MODE || "standard").toLowerCase();

  if (!usageMetadataList.length) {
    const emptyUsage = {
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

    return {
      ...emptyUsage,
      tokensAmount: getBillableCostFromUsage({
        usageMetadata: emptyUsage,
        model: MODEL,
        mode: pricingMode,
      }),
    };
  }

  if (usageMetadataList.length === 1) {
    const item = usageMetadataList[0];
    const meta = item?.usageMetadata || {};

    const singleUsage = {
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

    return {
      ...singleUsage,
      tokensAmount: getBillableCostFromUsage({
        usageMetadata: singleUsage,
        model: MODEL,
        mode: pricingMode,
      }),
    };
  }

  const mergedUsage = {
    promptTokenCount: usageMetadataList.reduce(
      (sum, item) => sum + Number(item?.usageMetadata?.promptTokenCount || 0),
      0,
    ),
    candidatesTokenCount: usageMetadataList.reduce(
      (sum, item) => sum + Number(item?.usageMetadata?.candidatesTokenCount || 0),
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

  return {
    ...mergedUsage,
    tokensAmount: getBillableCostFromUsage({
      usageMetadata: mergedUsage,
      model: MODEL,
      mode: pricingMode,
    }),
  };
}

async function extractSingleChunkFromGemini(fetchedFile, workItem, index, totalItems) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;
  const prompt = workItem.wasChunked
    ? buildChunkTaskPrompt(workItem)
    : buildTaskPrompt([workItem.originalFileName || workItem.displayName]);

  const response = await withRetry(
    async () => {
      setReadingStatus({
        status: "running",
        stage: "generating_content",
        progress: Math.min(75 + Math.floor((index / Math.max(totalItems, 1)) * 18), 94),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Extracting BL data from ${displayName}`,
        error: null,
      });

      return await ai.models.generateContent({
        model: MODEL,
        contents: [prompt, createPartFromUri(fetchedFile.uri, fetchedFile.mimeType)],
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Prefer null over guessing. Never return label text as a value. Follow the schema exactly.",
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

  parsed = sanitizeResult(normalizeResultShape(parsed));
  const usageEntries = [response?.usageMetadata || {}];

  let fallbackResult = null;
  try {
    fallbackResult = await extractFallbackFromGemini(
      fetchedFile,
      workItem,
      index,
      totalItems,
    );
    usageEntries.push(fallbackResult?.usageMetadata || {});
  } catch (fallbackError) {
    console.error(`Fallback extraction failed for ${displayName}:`, fallbackError);
  }

  const finalParsed = applyDeterministicFallback(
    parsed,
    workItem.deterministicFields || {},
    fallbackResult?.data || {},
  );

  const mergedUsageMetadata = {
    promptTokenCount: usageEntries.reduce(
      (sum, meta) => sum + Number(meta?.promptTokenCount || 0),
      0,
    ),
    candidatesTokenCount: usageEntries.reduce(
      (sum, meta) => sum + Number(meta?.candidatesTokenCount || 0),
      0,
    ),
    totalTokenCount: usageEntries.reduce(
      (sum, meta) => sum + Number(meta?.totalTokenCount || 0),
      0,
    ),
    thoughtsTokenCount: usageEntries.reduce(
      (sum, meta) => sum + Number(meta?.thoughtsTokenCount || 0),
      0,
    ),
    promptTokensDetails: mergePromptTokensDetails(
      usageEntries.map((meta) => ({ usageMetadata: meta })),
    ),
  };

  return {
    parsed: finalParsed,
    usageMetadata: mergedUsageMetadata,
  };
}

module.exports = {
  extractBlPdfData: async (req, res) => {
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
          error: "No PDF files received. Send file(s) in form-data using key 'file'.",
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

      const oversizeFile = files.find((f) => Number(f?.size || 0) > MAX_PDF_BYTES);
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
        message: "BL PDF extraction started",
        data: null,
        error: null,
      });

      res.status(202).json({
        success: true,
        message: "BL PDF extraction started",
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
            message: "Validating uploaded BL PDF files",
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

            const { parsed, usageMetadata } = await extractSingleChunkFromGemini(
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

          mergedResult = sanitizeResult(normalizeResultShape(mergedResult));
          const finalUsageMetadata = buildUsageMetadata(usageMetadataList);

          setReadingStatus({
            status: "completed",
            stage: "completed",
            progress: 100,
            currentFileIndex: workItems.length || null,
            totalFiles: workItems.length,
            currentFileName: null,
            fileState: null,
            message: "BL PDF data extracted successfully",
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
          console.error("Error extracting BL PDF data:", error);

          setReadingStatus({
            status: "failed",
            stage: "failed",
            progress: 100,
            currentFileName: null,
            fileState: null,
            message: error.message || "Failed to extract BL PDF data",
            error: error.message || "Failed to extract BL PDF data",
            data: null,
          });
        } finally {
          await deleteGeminiFiles(uploadedGeminiNames);
        }
      })();
    } catch (error) {
      console.error("Error starting BL PDF extraction:", error);

      setReadingStatus({
        status: "failed",
        stage: "failed",
        progress: 100,
        currentFileName: null,
        fileState: null,
        message: error.message || "Failed to start BL PDF extraction",
        error: error.message || "Failed to start BL PDF extraction",
        data: null,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to start BL PDF extraction",
      });
    }
  },

  getBlPdfExtractionStatus: async (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        readingStatus,
      });
    } catch (error) {
      console.error("Error getting BL PDF extraction status:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Failed to get reading status",
      });
    }
  },
};