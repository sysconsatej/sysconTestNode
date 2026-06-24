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
const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const BIG_PDF_BYTES = Number(process.env.BIG_PDF_BYTES || 15 * 1024 * 1024);
const BIG_PDF_PAGE_THRESHOLD = Number(process.env.BIG_PDF_PAGE_THRESHOLD || 25);
const PDF_CHUNK_PAGE_COUNT = Number(process.env.PDF_CHUNK_PAGE_COUNT || 12);
const GEMINI_GENERATE_RETRIES = Number(process.env.GEMINI_GENERATE_RETRIES || 3);
const GEMINI_RETRY_BASE_MS = Number(process.env.GEMINI_RETRY_BASE_MS || 3000);
const GEMINI_HIGH_DEMAND_RETRIES = Number(
  process.env.GEMINI_HIGH_DEMAND_RETRIES || 6,
);
const GEMINI_RETRY_MAX_DELAY_MS = Number(
  process.env.GEMINI_RETRY_MAX_DELAY_MS || 60000,
);
const GEMINI_FILE_POLL_INTERVAL_MS = Number(
  process.env.GEMINI_FILE_POLL_INTERVAL_MS || 2000,
);
const GEMINI_FILE_PROCESSING_TIMEOUT_MS = Number(
  process.env.GEMINI_FILE_PROCESSING_TIMEOUT_MS || 15 * 60 * 1000,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TARGET_FIELDS = [
  "consignorOrShipperName",
  "consignorOrShipperAddress",
  "consigneeName",
  "consigneeAddress",
  "notifyName",
  "notifyAddress",
  "vessel",
  "voyage",
  "placeOfReceipt",
  "portOfLoading",
  "placeOfDelivery",
  "portOfDischarge",
  "marksAndNumbers",
  "descriptionOfGoods",
  "marksAndNoAttach",
  "goodAndDescriptionAttach",
  "weight",
  "weightUnit",
  "measurement",
  "grossWeight",
  "grossWeightUnit",
  "netWeight",
  "netWeightUnit",
  "totalFreightAndCharges",
  "prepaidCollect",
  "loadFreeTimeForContainer",
  "dischargeFreeTimeForContainer",
  "containerDemurrageDaily",
  "shippedOnBoardDate",
  "freightPayableAt",
  "numberOfOriginalMtd",
  "placeIssue",
  "DateOfIssue",
  "forCompanyName",
  "mtdNo",
  "reportType",
  "tblContainer",
];

const FIELD_ALIASES = {
  consignorOrShipperName: [
    "CONSIGNOR",
    "CONSIGNOR SHIPPER",
    "SHIPPER",
    "SHIPPER EXPORTER",
    "SHIPPER NAME ADDRESS",
    "SHIPPER NAME AND ADDRESS",
    "EXPORTER",
    "CONSIGNOR/SHIPPER",
  ],
  consigneeName: [
    "CONSIGNEE",
    "CONSIGNEE IF TO ORDER SO INDICATE",
    "TO ORDER",
  ],
  notifyName: [
    "NOTIFY",
    "NOTIFY ADDRESS",
    "NOTIFY PARTY",
  ],
  vessel: [
    "VESSEL",
    "VESSEL NAME",
    "OCEAN VESSEL",
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
    "PORT OF LADING",
    "POL",
  ],
  placeOfDelivery: [
    "PLACE OF DELIVERY",
    "FINAL PLACE OF DELIVERY",
    "FPD",
  ],
  portOfDischarge: [
    "PORT OF DISCHARGE",
    "DISCHARGE PORT",
    "POD",
  ],
  marksAndNumbers: [
    "MARKS AND NUMBERS",
    "MARKS AND NUMBER",
    "MARKS NUMBER",
    "MARKS",
  ],
  descriptionOfGoods: [
    "DESCRIPTION OF GOODS",
    "DESCRIPTION OF PACKAGES AND GOODS",
    "GENERAL DESCRIPTION OF GOODS",
    "PARTICULARS FURNISHED BY MERCHANT",
    "SAID TO CONTAIN",
    "NO OF PKGS CNTRS DESCRIPTION OF PACKAGES AND GOODS",
  ],
  marksAndNoAttach: [
    "MARKS AND NO S",
    "MARKS AND NO",
    "MARKS NO S",
    "MARKS NO",
    "MARKS AND NUMBERS",
  ],
  goodAndDescriptionAttach: [
    "NO OF PKGS KINDS OF PKGS GENERAL DESCRIPTION OF GOODS",
    "NO OF PKGS KINDS OF PKGS DESCRIPTION OF GOODS",
    "GENERAL DESCRIPTION OF GOODS",
    "DESCRIPTION OF GOODS",
    "DESCRIPTION OF PACKAGES AND GOODS",
  ],
  weight: [
    "WEIGHT",
    "TOTAL WEIGHT",
  ],
  weightUnit: ["WEIGHT UNIT", "TOTAL WEIGHT UNIT"],
  measurement: [
    "MEASUREMENT",
    "TOTAL WEIGHT MEASUREMENT",
    "CBM",
    "CFT",
  ],
  grossWeight: [
    "GROSS WEIGHT",
    "GR WT",
  ],
  grossWeightUnit: ["GROSS WEIGHT UNIT", "GR WT UNIT"],
  netWeight: [
    "NET WEIGHT",
    "NT WT",
  ],
  netWeightUnit: ["NET WEIGHT UNIT", "NT WT UNIT"],
  totalFreightAndCharges: [
    "TOTAL FREIGHT & CHARGES",
    "TOTAL FREIGHT AND CHARGES",
  ],
  prepaidCollect: ["PREPAID / COLLECT", "PREPAID COLLECT"],
  loadFreeTimeForContainer: ["LOAD FREE TIME FOR CONTAINER"],
  dischargeFreeTimeForContainer: ["DISCHARGE FREE TIME FOR CONTAINER"],
  containerDemurrageDaily: [
    "CONTAINER DEMURRAGE (DAILY)",
    "CONTAINER DEMURRAGE DAILY",
  ],
  shippedOnBoardDate: [
    "SHIPPED ON BOARD DATE",
    "ON BOARD DATE",
    "SHIPPED DATE",
  ],
  freightPayableAt: [
    "FREIGHT PAYABLE AT",
    "FREIGHT PAYABLE LOCATION",
    "FREIGHT PAYABLE PLACE",
  ],
  numberOfOriginalMtd: [
    "NUMBER OF ORIGINAL MTD",
    "NUMBER OF ORIGINAL MTD S",
    "NO OF ORIGINAL MTD",
    "NO OF ORIGINAL MTDS",
    "NO OF ORIGINAL MTD S",
  ],
  placeIssue: [
    "PLACE DATE OF ISSUE",
    "PLACE AND DATE OF ISSUE",
    "PLACE OF ISSUE DATE OF ISSUE",
  ],
  DateOfIssue: ["DATE OF ISSUE"],
  forCompanyName: [
    "FOR",
    "SIGNED FOR",
  ],
  mtdNo: [
    "MTD NO",
    "BILL OF LADING NUMBER",
    "BL NUMBER",
  ],
};

const TABLE_HEADER_ALIASES = {
  containerNo: ["CONTAINER NO", "CONTAINERNO", "TANK NOS", "TANK NO", "TANK NOS."],
  type: ["TYPE"],
  customeSealNo: ["C SEAL NO", "CUSTOM SEAL NO", "C. SEAL NO", "CUSTOMESEALNO"],
  agentSealNo: ["S SEAL NO", "AGENT SEAL NO", "S. SEAL NO", "AGENTSEALNO"],
  ntWt: ["NT WT", "NT. WT", "NET WT"],
  tarWt: ["TARE WEIGHT", "TAREWT", "TAR WT"],
  grossWt: ["GR WT", "GR. WT", "GROSS WT"],
};

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

const STOP_SECTION_WORDS = [
  "EXCESS VALUE DECLARATION",
  "TOTAL FREIGHT",
  "PARTICULAR ABOVE FURNISHED",
  "FREIGHT CHARGES AMOUNT",
  "FREIGHT PAYABLE LOCATION",
  "OTHER PARTICULARS",
  "SIGNED FOR",
  "AUTHORISED SIGNATORY",
];

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
  if (typeof state === "object" && state.name) return String(state.name).toUpperCase();
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

function normalizeLabelToken(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      out[key] =
        key === "tblContainer"
          ? sanitizeContainerRows([...prev, ...value])
          : dedupeObjectArray([...prev, ...value]);
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

function splitContainerSizeAndType(typeValue, sizeValue) {
  let type = normalizeWhitespace(typeValue);
  let size = normalizeWhitespace(sizeValue);

  if (type) {
    const match = type.match(
      /^(\d{2})\s*(?:FT|['’])?\s*(?:\/|\-)?\s*([A-Z][A-Z0-9 -]*)$/i,
    );

    if (match) {
      size = size || match[1];
      type = normalizeWhitespace(match[2]);
    }
  }

  return {
    size: size || null,
    type: type || null,
  };
}

function splitPlaceAndDateOfIssue(combinedValue, placeValue, dateValue) {
  const combined = normalizeWhitespace(combinedValue);
  let placeIssue = normalizeWhitespace(placeValue);
  let DateOfIssue = normalizeWhitespace(dateValue);

  if (combined && (!placeIssue || !DateOfIssue)) {
    const dateMatch = combined.match(
      /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/,
    );

    if (dateMatch) {
      DateOfIssue = DateOfIssue || dateMatch[1];
      placeIssue =
        placeIssue ||
        normalizeWhitespace(
          combined
            .replace(dateMatch[0], "")
            .replace(/^[\s,:;\-]+|[\s,:;\-]+$/g, ""),
        );
    } else {
      placeIssue = placeIssue || combined;
    }
  }

  return {
    placeIssue: placeIssue || null,
    DateOfIssue: DateOfIssue || null,
  };
}

function normalizeContainerRow(row = {}) {
  const containerType = splitContainerSizeAndType(row.type, row.size);
  const netWeight = splitWeightAndUnit(row.ntWt, row.ntWtUnit);
  const tareWeight = splitWeightAndUnit(row.tarWt, row.tarWtUnit);
  const grossWeight = splitWeightAndUnit(row.grossWt, row.grossWtUnit);

  return {
    containerNo: row.containerNo ?? null,
    size: containerType.size,
    type: containerType.type,
    customeSealNo: row.customeSealNo ?? null,
    agentSealNo: row.agentSealNo ?? null,
    ntWt: netWeight.value,
    ntWtUnit: netWeight.unit,
    tarWt: tareWeight.value,
    tarWtUnit: tareWeight.unit,
    grossWt: grossWeight.value,
    grossWtUnit: grossWeight.unit,
  };
}

function normalizeResultShape(data = {}) {
  const issue = splitPlaceAndDateOfIssue(
    data.placeAndDateOfIssue,
    data.placeIssue,
    data.DateOfIssue,
  );

  return {
    consignorOrShipperName: data.consignorOrShipperName ?? null,
    consignorOrShipperAddress: data.consignorOrShipperAddress ?? null,
    consigneeName: data.consigneeName ?? null,
    consigneeAddress: data.consigneeAddress ?? null,
    notifyName: data.notifyName ?? null,
    notifyAddress: data.notifyAddress ?? null,
    vessel: data.vessel ?? null,
    voyage: data.voyage ?? null,
    placeOfReceipt: data.placeOfReceipt ?? null,
    portOfLoading: data.portOfLoading ?? null,
    placeOfDelivery: data.placeOfDelivery ?? null,
    portOfDischarge: data.portOfDischarge ?? null,
    marksAndNumbers: data.marksAndNumbers ?? null,
    descriptionOfGoods: data.descriptionOfGoods ?? null,
    marksAndNoAttach: data.marksAndNoAttach ?? null,
    goodAndDescriptionAttach: data.goodAndDescriptionAttach ?? null,
    weight: data.weight ?? null,
    weightUnit: data.weightUnit ?? null,
    measurement: data.measurement ?? null,
    grossWeight: data.grossWeight ?? null,
    grossWeightUnit: data.grossWeightUnit ?? null,
    netWeight: data.netWeight ?? null,
    netWeightUnit: data.netWeightUnit ?? null,
    totalFreightAndCharges: data.totalFreightAndCharges ?? null,
    prepaidCollect: data.prepaidCollect ?? null,
    loadFreeTimeForContainer: data.loadFreeTimeForContainer ?? null,
    dischargeFreeTimeForContainer: data.dischargeFreeTimeForContainer ?? null,
    containerDemurrageDaily: data.containerDemurrageDaily ?? null,
    shippedOnBoardDate: data.shippedOnBoardDate ?? null,
    freightPayableAt: data.freightPayableAt ?? null,
    numberOfOriginalMtd: data.numberOfOriginalMtd ?? null,
    placeIssue: issue.placeIssue,
    DateOfIssue: issue.DateOfIssue,
    forCompanyName: data.forCompanyName ?? null,
    mtdNo: data.mtdNo ?? null,
    reportType: data.reportType ?? null,
    tblContainer: Array.isArray(data.tblContainer) ? data.tblContainer : [],
  };
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

const ALL_LABELS = Object.values(FIELD_ALIASES).flat();

function looksLikeStopLabel(line) {
  const normalized = normalizeLabelToken(line);
  if (!normalized) return false;

  return ALL_LABELS.some((alias) => {
    const a = normalizeLabelToken(alias);
    return normalized === a || normalized.startsWith(`${a} `);
  });
}

function collectFollowingBlock(lines, startIndex, options = {}) {
  const { maxLines = 8 } = options;
  const buffer = [];

  for (let i = startIndex + 1; i < lines.length && buffer.length < maxLines; i++) {
    const line = lines[i];
    if (!line) continue;
    if (looksLikeStopLabel(line)) break;
    buffer.push(line);
  }

  return normalizeWhitespace(buffer.join(" "));
}

function collectFollowingBlockLines(lines, startIndex, options = {}) {
  const { maxLines = 8 } = options;
  const buffer = [];

  for (let i = startIndex + 1; i < lines.length && buffer.length < maxLines; i++) {
    const line = lines[i];
    if (!line) continue;
    if (looksLikeStopLabel(line)) break;
    buffer.push(line);
  }

  return buffer;
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

function findPartyBlockLines(lines, aliases = [], options = {}) {
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

        const nextLines = collectFollowingBlockLines(lines, i, { maxLines });
        return [inline, ...nextLines].filter(Boolean);
      }

      if (normalizedLine === alias) {
        return collectFollowingBlockLines(lines, i, { maxLines });
      }
    }
  }

  return [];
}

function splitPartyBlockLines(blockLines = []) {
  const lines = (Array.isArray(blockLines) ? blockLines : [])
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  if (!lines.length) {
    return {
      name: null,
      address: null,
    };
  }

  return {
    name: lines[0] || null,
    address: normalizeWhitespace(lines.slice(1).join(" ")) || null,
  };
}

function extractMarksBlock(text = "") {
  return firstNonEmptyMatch(text, [
    /(?:MARKS\s+AND\s+NUMBERS|MARKS\s*&\s*NUMBERS|MARKS\s+AND\s+NUMBER|MARKS)\s*[:\n]*([\s\S]{1,800}?)(?=\b(?:DESCRIPTION\s+OF\s+GOODS|DESCRIPTION\s+OF\s+PACKAGES\s+AND\s+GOODS|GENERAL\s+DESCRIPTION\s+OF\s+GOODS|TOTAL\s+WEIGHT|MEASUREMENT|GROSS\s+WEIGHT|NET\s+WEIGHT|TANK\s+NOS|CONTAINER\s+NO)\b)/i,
  ]);
}

function extractDescriptionBlock(text = "") {
  return firstNonEmptyMatch(text, [
    /(?:DESCRIPTION\s+OF\s+GOODS|DESCRIPTION\s+OF\s+PACKAGES\s+AND\s+GOODS|GENERAL\s+DESCRIPTION\s+OF\s+GOODS|PARTICULARS\s+FURNISHED\s+BY\s+MERCHANT)\s*[:\n]*([\s\S]{10,2800}?)(?=\b(?:TOTAL\s+WEIGHT|MEASUREMENT|GROSS\s+WEIGHT|NET\s+WEIGHT|NUMBER\s+OF\s+ORIGINAL|FREIGHT\s+PAYABLE\s+AT|FREIGHT\s+PAYABLE\s+LOCATION|PLACE\s*&\s*DATE\s+OF\s+ISSUE|PLACE\s+AND\s+DATE\s+OF\s+ISSUE|SHIPPED\s+ON\s+BOARD\s+DATE|TANK\s+NOS|CONTAINER\s+NO)\b)/i,
  ]);
}

function getAttachedSheetText(rawText = "") {
  const text = String(rawText || "");
  const idx = text.toUpperCase().indexOf("ATTACHED SHEET");
  if (idx === -1) return "";
  return text.slice(idx);
}

function extractAttachFieldsFromText(rawText = "") {
  const attachText = getAttachedSheetText(rawText);
  if (!attachText) {
    return {
      marksAndNoAttach: null,
      goodAndDescriptionAttach: null,
    };
  }

  const lines = getLines(attachText);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeLabelToken(lines[i]);
    if (
      n.includes("MARKS AND NO") &&
      (n.includes("GENERAL DESCRIPTION OF GOODS") || n.includes("DESCRIPTION OF GOODS"))
    ) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) {
    startIdx = lines.findIndex((line) =>
      normalizeLabelToken(line).includes("MARKS AND NO"),
    );
  }

  let blockLines = [];
  if (startIdx !== -1) {
    for (let j = startIdx + 1; j < lines.length; j++) {
      const n = normalizeLabelToken(lines[j]);
      if (n.includes("TANK NOS") || n.includes("CONTAINER NO")) break;
      if (STOP_SECTION_WORDS.some((word) => n.startsWith(word))) break;
      blockLines.push(lines[j]);
    }
  }

  const blockText = normalizeWhitespace(blockLines.join(" "));

  return {
    marksAndNoAttach: blockText || null,
    goodAndDescriptionAttach: blockText || null,
  };
}

function looksLikeContainerHeader(line = "") {
  const n = normalizeLabelToken(line);

  const containerAliasFound = TABLE_HEADER_ALIASES.containerNo
    .map(normalizeLabelToken)
    .some((alias) => n.includes(alias));

  const typeFound = TABLE_HEADER_ALIASES.type
    .map(normalizeLabelToken)
    .some((alias) => n.includes(alias));

  const grossFound = TABLE_HEADER_ALIASES.grossWt
    .map(normalizeLabelToken)
    .some((alias) => n.includes(alias));

  return containerAliasFound && typeFound && grossFound;
}

function isContainerTableStopLine(line = "") {
  const n = normalizeLabelToken(line);
  return STOP_SECTION_WORDS.some((word) => n.startsWith(word));
}

function parseWeightToken(tokens, endIndex) {
  if (endIndex < 0) return { value: null, used: 0 };

  const last = tokens[endIndex] || "";
  const prev = tokens[endIndex - 1] || "";

  if (/^(KGS?|KG|MTS?|MT)$/i.test(last) && prev) {
    return { value: `${prev} ${last}`, used: 2 };
  }

  return { value: last || null, used: 1 };
}

function parseContainerRow(line = "") {
  const raw = normalizeWhitespace(line);
  if (!raw) return null;

  const tokens = raw.split(/\s+/);
  if (tokens.length < 5) return null;

  const containerNo = tokens[0];
  if (!/^[A-Z0-9]{6,15}$/i.test(containerNo)) return null;

  let idx = tokens.length - 1;

  const gross = parseWeightToken(tokens, idx);
  idx -= gross.used;

  const tare = parseWeightToken(tokens, idx);
  idx -= tare.used;

  const net = parseWeightToken(tokens, idx);
  idx -= net.used;

  const middle = tokens.slice(1, idx + 1);

  let customeSealNo = null;
  let agentSealNo = null;
  let type = null;

  const middleText = middle.join(" ").toUpperCase();

  if (middle.length >= 4 && middleText.includes("ISO")) {
    customeSealNo = middle[middle.length - 1] || null;
    type = middle.slice(0, -1).join(" ");
  } else if (middle.length >= 5) {
    const maybeLast = middle[middle.length - 1];
    const maybeSecondLast = middle[middle.length - 2];
    const looksLikeSeal = (v) => /^[A-Z0-9\-\/]{2,20}$/i.test(v);

    if (looksLikeSeal(maybeLast) && looksLikeSeal(maybeSecondLast)) {
      customeSealNo = maybeSecondLast;
      agentSealNo = maybeLast;
      type = middle.slice(0, -2).join(" ");
    } else {
      type = middle.join(" ");
    }
  } else {
    type = middle.join(" ");
  }

  const parsed = {
    containerNo: normalizeWhitespace(containerNo),
    type: normalizeWhitespace(type),
    customeSealNo: normalizeWhitespace(customeSealNo),
    agentSealNo: normalizeWhitespace(agentSealNo),
    ntWt: normalizeWhitespace(net.value),
    tarWt: normalizeWhitespace(tare.value),
    grossWt: normalizeWhitespace(gross.value),
  };

  if (!parsed.containerNo || !parsed.grossWt) return null;
  return parsed;
}

function extractContainerTableFromText(rawText = "") {
  const lines = getLines(rawText);
  const rows = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTable && looksLikeContainerHeader(line)) {
      inTable = true;
      continue;
    }

    if (!inTable) continue;

    if (isContainerTableStopLine(line) || line.toUpperCase().includes("ATTACHED SHEET")) {
      inTable = false;
      continue;
    }

    const row = parseContainerRow(line);
    if (row) rows.push(row);
  }

  return dedupeObjectArray(rows.map(normalizeContainerRow));
}

function extractDeterministicFieldsFromText(rawText = "") {
  const text = String(rawText || "");
  const lines = getLines(text);

  const reportType = /\bDRAFT\b/i.test(text)
    ? "DRAFT"
    : /\bFINAL\b/i.test(text)
      ? "FINAL"
      : null;

  const consignorParty = splitPartyBlockLines(
    findPartyBlockLines(lines, FIELD_ALIASES.consignorOrShipperName, {
      maxLines: 8,
    }),
  );

  const consigneeParty = splitPartyBlockLines(
    findPartyBlockLines(lines, FIELD_ALIASES.consigneeName, {
      maxLines: 8,
    }),
  );

  const notifyParty = splitPartyBlockLines(
    findPartyBlockLines(lines, FIELD_ALIASES.notifyName, {
      maxLines: 8,
    }),
  );

  const issue = splitPlaceAndDateOfIssue(
    firstNonEmptyMatch(text, [
      /PLACE\s*&\s*DATE\s+OF\s+ISSUE\s*:?\s*([^\n\r]{2,160})/i,
      /PLACE\s+AND\s+DATE\s+OF\s+ISSUE\s*:?\s*([^\n\r]{2,160})/i,
    ]),
  );

  const direct = {
    consignorOrShipperName: consignorParty.name,
    consignorOrShipperAddress: consignorParty.address,

    consigneeName: consigneeParty.name,
    consigneeAddress: consigneeParty.address,

    notifyName: notifyParty.name,
    notifyAddress: notifyParty.address,

    mtdNo: firstNonEmptyMatch(text, [
      /MTD\s*NO\.?\s*:?\s*([A-Za-z0-9/._\- ]{6,80})/i,
      /BILL\s+OF\s+LADING\s+NUMBER\s*:?\s*([A-Za-z0-9/._\- ]{6,80})/i,
      /BL\s+NUMBER\s*:?\s*([A-Za-z0-9/._\- ]{6,80})/i,
    ]),
    grossWeight: firstNonEmptyMatch(text, [
      /GROSS\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /GR\s+WT\.?\s*:?\s*([^\n\r]{2,80})/i,
    ]),
    netWeight: firstNonEmptyMatch(text, [
      /NET\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /NT\s+WT\.?\s*:?\s*([^\n\r]{2,80})/i,
    ]),
    weight: firstNonEmptyMatch(text, [
      /(?:^|\n)WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
      /(?:^|\n)TOTAL\s+WEIGHT\s*:?\s*([^\n\r]{2,80})/i,
    ]),
    measurement: firstNonEmptyMatch(text, [
      /MEASUREMENT\s*:?\s*([^\n\r]{2,80})/i,
      /(?:^|\n)([0-9., ]+\s*(?:CBM|CFT))\b/i,
    ]),
    freightPayableAt: firstNonEmptyMatch(text, [
      /FREIGHT\s+PAYABLE\s+AT\s*:?\s*([^\n\r]{2,120})/i,
      /FREIGHT\s+PAYABLE\s+LOCATION\s*:?\s*([^\n\r]{2,120})/i,
    ]),
    numberOfOriginalMtd: firstNonEmptyMatch(text, [
      /NUMBER\s+OF\s+ORIGINAL\s+MTD\(?S?\)?\s*:?\s*([^\n\r]{1,60})/i,
      /NO\.?\s+OF\s+ORIGINAL\s+MTD\(?S?\)?\s*:?\s*([^\n\r]{1,60})/i,
    ]),
    shippedOnBoardDate: firstNonEmptyMatch(text, [
      /SHIPPED\s+ON\s+BOARD\s+DATE\s*:?\s*([^\n\r]{2,80})/i,
    ]),
    placeIssue: issue.placeIssue,
    DateOfIssue: issue.DateOfIssue,
    forCompanyName: firstNonEmptyMatch(text, [
      /(?:^|\n)For\s+([A-Za-z0-9&.,'()\/\- ]{3,120})(?:\n|$)/im,
      /SIGNED\s+FOR\s+([A-Za-z0-9&.,'()\/\- ]{3,120})(?:\n|$)/im,
    ]),
    marksAndNumbers: extractMarksBlock(text),
    descriptionOfGoods: extractDescriptionBlock(text),
  };

  const attach = extractAttachFieldsFromText(text);

  const block = {
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

  if (!block.vessel || !block.voyage) {
    const vv = firstNonEmptyMatch(text, [
      /OCEAN\s+VESSEL\s+VOYAGE\s+NUMBER\s*([\s\S]{1,80}?)\s*(?:PORT\s+OF\s+DISCHARGE|PLACE\s+OF\s+RECEIPT)/i,
    ]);
    if (vv && vv.includes("/")) {
      const parts = vv.split("/").map((x) => normalizeWhitespace(x));
      if (!block.vessel) block.vessel = parts[0] || null;
      if (!block.voyage) block.voyage = parts[1] || null;
    }
  }

  return {
    ...direct,
    ...block,
    ...attach,
    tblContainer: extractContainerTableFromText(text),
    reportType,
  };
}

function sanitizeContainerRows(rows = []) {
  const rowsByContainerNo = new Map();

  for (const row of rows || []) {
    const r = normalizeContainerRow(row);
    r.containerNo = normalizeWhitespace(r.containerNo);
    r.size = normalizeWhitespace(r.size);
    r.type = normalizeWhitespace(r.type);
    r.customeSealNo = normalizeWhitespace(r.customeSealNo);
    r.agentSealNo = normalizeWhitespace(r.agentSealNo);
    r.ntWt = normalizeWhitespace(r.ntWt);
    r.ntWtUnit = normalizeWhitespace(r.ntWtUnit);
    r.tarWt = normalizeWhitespace(r.tarWt);
    r.tarWtUnit = normalizeWhitespace(r.tarWtUnit);
    r.grossWt = normalizeWhitespace(r.grossWt);
    r.grossWtUnit = normalizeWhitespace(r.grossWtUnit);

    if (!r.containerNo && !r.grossWt && !r.ntWt) continue;

    const normalizedContainerNo = String(r.containerNo || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const key = normalizedContainerNo
      ? `container:${normalizedContainerNo}`
      : `row:${stableStringify(r)}`;

    const existing = rowsByContainerNo.get(key);
    rowsByContainerNo.set(key, existing ? mergeFlatObject(existing, r) : r);
  }

  return [...rowsByContainerNo.values()];
}

function isLabelOnlyValue(field, value) {
  if (!isMeaningfulValue(value)) return true;

  const normalized = normalizeLabelToken(value);
  if (!normalized) return true;

  const aliases = (FIELD_ALIASES[field] || []).map(normalizeLabelToken);
  if (aliases.includes(normalized)) return true;

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

function splitWeightAndUnit(value, explicitUnit) {
  let weight = normalizeWhitespace(value);
  let unit = normalizeWhitespace(explicitUnit);

  if (weight) {
    const match = weight.match(
      /^(.+?)[\s,]*(KGS?|KG|LBS?|LB|MTS?|MT|TONNES?|TONS?)\.?$/i,
    );

    if (match) {
      weight = normalizeWhitespace(match[1]);
      unit = unit || match[2];
    }
  }

  return {
    value: weight || null,
    unit: unit ? String(unit).replace(/\.$/, "").toUpperCase() : null,
  };
}

function removeTrailingIndia(value) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  return normalizeWhitespace(normalized.replace(/,\s*INDIA\s*$/i, ""));
}

function sanitizeResult(data = {}) {
  const out = normalizeResultShape(data);

  TARGET_FIELDS.forEach((field) => {
    if (field === "tblContainer") return;

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

  out.tblContainer = sanitizeContainerRows(out.tblContainer);
  out.placeOfReceipt = removeTrailingIndia(out.placeOfReceipt);
  out.portOfLoading = removeTrailingIndia(out.portOfLoading);

  const weight = splitWeightAndUnit(out.weight, out.weightUnit);
  out.weight = weight.value;
  out.weightUnit = weight.unit;

  const grossWeight = splitWeightAndUnit(out.grossWeight, out.grossWeightUnit);
  out.grossWeight = grossWeight.value;
  out.grossWeightUnit = grossWeight.unit;

  const netWeight = splitWeightAndUnit(out.netWeight, out.netWeightUnit);
  out.netWeight = netWeight.value;
  out.netWeightUnit = netWeight.unit;

  if (!out.weight) {
    out.weight = out.grossWeight || out.netWeight || null;
    out.weightUnit = out.grossWeight
      ? out.grossWeightUnit
      : out.netWeight
        ? out.netWeightUnit
        : null;
  }

  if (
    !out.numberOfOriginalMtd &&
    out.freightPayableAt &&
    NUMBER_WORDS.has(String(out.freightPayableAt).toUpperCase())
  ) {
    out.numberOfOriginalMtd = out.freightPayableAt;
    out.freightPayableAt = null;
  }

  return out;
}

function pickBestValue(candidates = [], validator = () => true) {
  const prepared = candidates
    .map((item) => (typeof item === "string" ? { value: item, source: "unknown" } : item))
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

function applyDeterministicFallback(main = {}, deterministic = {}, fallback = {}) {
  const out = {};

  Object.keys(normalizeResultShape({})).forEach((field) => {
    if (field === "tblContainer") {
      out.tblContainer = sanitizeContainerRows([
        ...(Array.isArray(main?.tblContainer) ? main.tblContainer : []),
        ...(Array.isArray(fallback?.tblContainer) ? fallback.tblContainer : []),
        ...(Array.isArray(deterministic?.tblContainer) ? deterministic.tblContainer : []),
      ]);
      return;
    }

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

function isGeminiHighDemandError(error) {
  const message = String(
    error?.message ||
      error?.cause?.message ||
      error?.cause?.code ||
      error ||
      "",
  ).toLowerCase();

  return [
    "503",
    "unavailable",
    "high demand",
    "temporarily unavailable",
    "overloaded",
  ].some((token) => message.includes(token));
}

async function withRetry(fn, options = {}) {
  const {
    retries = GEMINI_GENERATE_RETRIES,
    highDemandRetries = GEMINI_HIGH_DEMAND_RETRIES,
    baseDelayMs = GEMINI_RETRY_BASE_MS,
    label = "operation",
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const allowedRetries = isGeminiHighDemandError(error)
        ? Math.max(retries, highDemandRetries)
        : retries;

      if (attempt > allowedRetries || !isRetryableGeminiError(error)) {
        throw error;
      }

      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        GEMINI_RETRY_MAX_DELAY_MS,
      );

      if (typeof onRetry === "function") {
        onRetry(error, attempt, delayMs, label);
      } else {
        console.warn(
          `${label} failed temporarily. Retrying in ${delayMs} ms ` +
            `(attempt ${attempt + 1}/${allowedRetries + 1}).`,
        );

        if (readingStatus.status === "running") {
          setReadingStatus({
            message:
              `Gemini is temporarily unavailable. Retrying ${label} in ` +
              `${Math.ceil(delayMs / 1000)} seconds ` +
              `(attempt ${attempt + 1}/${allowedRetries + 1})`,
            error: null,
          });
        }
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function generateContentWithModelFailover(generate, label, preferredModel = null) {
  const models = uniqueNonEmpty([preferredModel, MODEL, FALLBACK_MODEL]);
  let lastError;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    const isPrimaryModel = model === MODEL && models.length > 1;
    const primaryRetries = Math.min(GEMINI_GENERATE_RETRIES, 2);

    try {
      const response = await withRetry(() => generate(model), {
        label: `${label} using ${model}`,
        retries: isPrimaryModel ? primaryRetries : GEMINI_GENERATE_RETRIES,
        highDemandRetries: isPrimaryModel
          ? primaryRetries
          : GEMINI_HIGH_DEMAND_RETRIES,
      });

      return { response, modelUsed: model };
    } catch (error) {
      lastError = error;

      const nextModel = models[modelIndex + 1];
      if (!nextModel || !isGeminiHighDemandError(error)) {
        throw error;
      }

      console.warn(
        `${model} is unavailable due to high demand. Switching to ${nextModel}.`,
      );

      if (readingStatus.status === "running") {
        setReadingStatus({
          message:
            `${model} is experiencing high demand. ` +
            `Continuing with fallback model ${nextModel}.`,
          error: null,
        });
      }
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

const CONTAINER_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    containerNo: S.str("Container No or Tank NOS."),
    size: S.str("Container size only, for example 20 from '20 / TK'."),
    type: S.str("Container type only, for example TK from '20 / TK'."),
    customeSealNo: S.str("C. SEAL NO or custom seal number."),
    agentSealNo: S.str("S. SEAL NO or agent seal number."),
    ntWt: S.str("NT. WT / Net Weight value only, without its unit."),
    ntWtUnit: S.str("Unit printed for NT. WT / Net Weight, for example KGS."),
    tarWt: S.str("Tare Weight value only, without its unit."),
    tarWtUnit: S.str("Unit printed for Tare Weight, for example KGS."),
    grossWt: S.str("GR. WT / Gross Weight value only, without its unit."),
    grossWtUnit: S.str("Unit printed for GR. WT / Gross Weight, for example KGS."),
  },
  required: [],
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    consignorOrShipperName: S.str(
      "Consignor/Shipper company name only, usually the first line of the consignor/shipper block.",
    ),
    consignorOrShipperAddress: S.str(
      "Address part of consignor/shipper block, excluding the first company-name line.",
    ),
    consigneeName: S.str(
      "Consignee company name only, usually the first line of the consignee block.",
    ),
    consigneeAddress: S.str(
      "Address part of consignee block, excluding the first company-name line.",
    ),
    notifyName: S.str(
      "Notify company name only, usually the first line of the notify block.",
    ),
    notifyAddress: S.str(
      "Address part of notify block, excluding the first company-name line.",
    ),
    vessel: S.str("Vessel value."),
    voyage: S.str("Voyage value."),
    placeOfReceipt: S.str("Place of receipt."),
    portOfLoading: S.str("Port of loading."),
    placeOfDelivery: S.str("Place of delivery."),
    portOfDischarge: S.str("Port of discharge."),
    marksAndNumbers: S.str("Main marks and numbers block."),
    descriptionOfGoods: S.str("Main goods description block."),
    marksAndNoAttach: S.str("Attached sheet marks and numbers block."),
    goodAndDescriptionAttach: S.str("Attached sheet goods description block."),
    weight: S.str("Weight value only, without its unit."),
    weightUnit: S.str("Unit printed for weight, for example KGS."),
    measurement: S.str("Measurement."),
    grossWeight: S.str("Gross weight value only, without its unit."),
    grossWeightUnit: S.str("Unit printed for gross weight, for example KGS."),
    netWeight: S.str("Net weight value only, without its unit."),
    netWeightUnit: S.str("Unit printed for net weight, for example KGS."),
    totalFreightAndCharges: S.str("Value under Total Freight & Charges."),
    prepaidCollect: S.str("Value under Prepaid / Collect, such as PREPAID or COLLECT."),
    loadFreeTimeForContainer: S.str("Value under Load Free Time For Container."),
    dischargeFreeTimeForContainer: S.str(
      "Value under Discharge Free Time For Container.",
    ),
    containerDemurrageDaily: S.str("Value under Container Demurrage (daily)."),
    shippedOnBoardDate: S.str("Shipped on board date."),
    freightPayableAt: S.str("Freight payable at."),
    numberOfOriginalMtd: S.str("Number of original MTD."),
    placeIssue: S.str("Place of issue only, without the issue date."),
    DateOfIssue: S.str("Date of issue only, without the issue place."),
    forCompanyName: S.str("Company name after 'For' or 'Signed for'."),
    mtdNo: S.str("MTD number / BL number."),
    reportType: S.str("DRAFT or FINAL."),
    tblContainer: {
      type: "array",
      items: CONTAINER_ITEM_SCHEMA,
    },
  },
  required: [],
};

function buildTaskPrompt(fileNames = []) {
  return `
You are a high-accuracy BL / MTD PDF extraction engine.

Return ONLY valid JSON matching the schema.

Important:
- Different PDFs use different labels.
- Extract attached-sheet values separately.
- Do not merge attached-sheet data into the main body fields.
- tblContainer must include rows from table headers like Tank NOS / TYPE / C. SEAL NO / S. SEAL NO / NT. WT / Tare Weight / GR. WT.
- Split combined container TYPE values such as '20 / TK' into size: '20' and type: 'TK'.
- In each tblContainer row, keep ntWt, tarWt, and grossWt as values only and put their units in ntWtUnit, tarWtUnit, and grossWtUnit.
- consignorOrShipperName / consigneeName / notifyName must contain only the company name.
- consignorOrShipperAddress / consigneeAddress / notifyAddress must contain the remaining address lines.
- Keep weight, grossWeight, and netWeight as values only; put their units in weightUnit, grossWeightUnit, and netWeightUnit.
- Extract the Total Freight & Charges table into totalFreightAndCharges, prepaidCollect, loadFreeTimeForContainer, dischargeFreeTimeForContainer, and containerDemurrageDaily.
- Split Place & Date of Issue into placeIssue and DateOfIssue.
- For placeOfReceipt and portOfLoading, remove a trailing ', INDIA'; for example, return MUNDRA instead of MUNDRA, INDIA.
- If a field is blank, return null.
- Never return the label text as the value.

File names:
${fileNames.join(", ") || "N/A"}
`;
}

function buildChunkTaskPrompt(workItem) {
  return `
${buildTaskPrompt([workItem.originalFileName || workItem.displayName])}

This is chunk ${workItem.partIndex} of ${workItem.partCount}.
Extract only what is visible in this chunk.
`;
}

function buildFallbackPrompt(workItem) {
  return `
${buildTaskPrompt([workItem.originalFileName || workItem.displayName])}

This is a fallback pass.
Focus especially on:
- consignorOrShipperName / consignorOrShipperAddress
- consigneeName / consigneeAddress
- notifyName / notifyAddress
- marksAndNoAttach
- goodAndDescriptionAttach
- tblContainer
- vessel / voyage
- weight / weightUnit / grossWeight / grossWeightUnit / netWeight / netWeightUnit
- totalFreightAndCharges / prepaidCollect / loadFreeTimeForContainer / dischargeFreeTimeForContainer / containerDemurrageDaily
`;
}

function getUploadedFiles(req) {
  if (!req.files || typeof req.files !== "object") return [];

  const files = [];
  for (const value of Object.values(req.files)) {
    if (Array.isArray(value)) files.push(...value);
    else if (value) files.push(value);
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
      } catch (_) {}
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

    for (let i = start; i < end; i++) pageIndexes.push(i);

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
        } catch (_) {}
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
    } catch (_) {
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
      },
    );

    uploadedName = uploaded.name;

    const startedAt = Date.now();
    let fetchedFile = await withRetry(
      async () => await ai.files.get({ name: uploaded.name }),
      { label: `get uploaded file ${displayName}` },
    );

    while (safeFileState(fetchedFile.state) === "PROCESSING") {
      if (Date.now() - startedAt > GEMINI_FILE_PROCESSING_TIMEOUT_MS) {
        throw new Error(`Gemini file processing timed out for ${displayName}`);
      }

      setReadingStatus({
        status: "running",
        stage: "gemini_processing_file",
        progress: Math.min(60, 45 + Math.floor((index / Math.max(totalItems, 1)) * 15)),
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
    }

    if (safeFileState(fetchedFile.state) === "FAILED") {
      throw new Error(`Gemini failed to process file: ${displayName}`);
    }

    setReadingStatus({
      status: "running",
      stage: "gemini_file_ready",
      progress: Math.min(75, 60 + Math.floor(((index + 1) / totalItems) * 10)),
      currentFileIndex: index + 1,
      totalFiles: totalItems,
      currentFileName: displayName,
      fileState: safeFileState(fetchedFile.state),
      message: `${displayName} is ready for extraction`,
      error: null,
    });

    return { fetchedFile, uploadedName };
  } finally {
    await cleanupLocalFile();
  }
}

async function deleteGeminiFiles(fileNames = []) {
  for (const name of fileNames) {
    try {
      await ai.files.delete({ name });
    } catch (_) {}
  }
}

async function extractFallbackFromGemini(
  fetchedFile,
  workItem,
  index,
  totalItems,
  preferredModel,
) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;

  const { response, modelUsed } = await generateContentWithModelFailover(
    async (model) => {
      setReadingStatus({
        status: "running",
        stage: "extracting_fallback",
        progress: Math.min(92, 84 + Math.floor((index / Math.max(totalItems, 1)) * 8)),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Retrying extraction for ${displayName}`,
        error: null,
      });

      return await ai.models.generateContent({
        model,
        contents: [
          buildFallbackPrompt(workItem),
          createPartFromUri(fetchedFile.uri, fetchedFile.mimeType),
        ],
        config: {
          temperature: 0,
          systemInstruction:
            "You are a strict JSON extraction engine. Preserve business values exactly as printed. Never return label text as the value.",
          responseMimeType: "application/json",
          responseJsonSchema: EXTRACTION_SCHEMA,
        },
      });
    },
    `fallback ${displayName}`,
    preferredModel,
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini raw fallback response:", response.text);
    throw new Error(`Gemini returned invalid fallback JSON for ${displayName}`);
  }

  return {
    data: normalizeResultShape(parsed),
    usageMetadata: response?.usageMetadata || {},
    modelUsed,
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

const GEMINI_PRICING = {
  "gemini-2.5-flash": {
    standard: { inputPer1M: 0.3, outputPer1M: 2.5 },
  },
  "gemini-2.5-flash-lite": {
    standard: { inputPer1M: 0.1, outputPer1M: 0.4 },
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
    return {
      inputTokens: 0,
      outputTokens: 0,
      thoughtsTokenCount: 0,
      inputRatePer1M: 0,
      outputRatePer1M: 0,
      inputCostUSD: 0,
      outputCostUSD: 0,
      totalCostUSD: 0,
    };
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
      modelsUsed: [],
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
    modelsUsed: uniqueNonEmpty(
      usageMetadataList.flatMap((item) => item?.usageMetadata?.modelsUsed || []),
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
      model:
        mergedUsage.modelsUsed.length === 1
          ? mergedUsage.modelsUsed[0]
          : MODEL,
      mode: pricingMode,
    }),
  };
}

async function extractSingleChunkFromGemini(fetchedFile, workItem, index, totalItems) {
  const displayName = workItem.displayName || `file-${index + 1}.pdf`;
  const prompt = workItem.wasChunked
    ? buildChunkTaskPrompt(workItem)
    : buildTaskPrompt([workItem.originalFileName || workItem.displayName]);

  const { response, modelUsed } = await generateContentWithModelFailover(
    async (model) => {
      setReadingStatus({
        status: "running",
        stage: "generating_content",
        progress: Math.min(90, 75 + Math.floor((index / Math.max(totalItems, 1)) * 18)),
        currentFileIndex: index + 1,
        totalFiles: totalItems,
        currentFileName: displayName,
        message: `Extracting BL data from ${displayName}`,
        error: null,
      });

      return await ai.models.generateContent({
        model,
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
    `generate content ${displayName}`,
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini raw response:", response.text);
    throw new Error(`Gemini returned invalid JSON for ${displayName}`);
  }

  parsed = sanitizeResult(normalizeResultShape(parsed));
  const usageEntries = [
    {
      ...(response?.usageMetadata || {}),
      modelUsed,
    },
  ];

  let fallbackResult = null;
  try {
    fallbackResult = await extractFallbackFromGemini(
      fetchedFile,
      workItem,
      index,
      totalItems,
      modelUsed,
    );
    usageEntries.push({
      ...(fallbackResult?.usageMetadata || {}),
      modelUsed: fallbackResult?.modelUsed,
    });
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
    modelsUsed: uniqueNonEmpty(usageEntries.map((meta) => meta?.modelUsed)),
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
          error: `Only PDF files are allowed. Invalid file: ${invalidFile.name || "unknown"}`,
        });
      }

      const oversizeFile = files.find((f) => Number(f?.size || 0) > MAX_PDF_BYTES);
      if (oversizeFile) {
        return res.status(400).json({
          success: false,
          error: `PDF file is too large. Max 50 MB per PDF. Invalid file: ${oversizeFile.name || "unknown"}`,
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
