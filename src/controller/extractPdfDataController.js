const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");
const { GoogleGenAI, createPartFromUri } = require("@google/genai");

const pdfParseModule = require("pdf-parse");
const pdfParse =
  typeof pdfParseModule === "function"
    ? pdfParseModule
    : typeof pdfParseModule?.default === "function"
      ? pdfParseModule.default
      : null;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_PDF_BYTES = 50 * 1024 * 1024;

// Big PDF handling
const BIG_PDF_BYTES = Number(process.env.BIG_PDF_BYTES || 15 * 1024 * 1024);
const BIG_PDF_PAGE_THRESHOLD = Number(
  process.env.BIG_PDF_PAGE_THRESHOLD || 25,
);
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

/* ------------------------ invoice helpers ------------------------ */

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
  if (/^[A-Za-z][\/-]/.test(s)) score += 4;
  if (/^[A-Za-z0-9][A-Za-z0-9\/._\- ]*$/.test(s)) score += 2;
  if (/^\d+$/.test(s)) score -= 4;
  if (/invoice|number|document|bill/i.test(s)) score -= 10;

  if (source === "pdf_text") score += 10;
  if (source === "gemini_invoice_fallback") score += 2;
  if (source === "gemini_main") score += 1;

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

async function extractPdfTextInfo(buffer, fileName = "upload.pdf") {
  try {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      return {
        rawText: "",
        lines: [],
        isPSAInvoice: false,
        matchedBy: [],
        textInvoiceCandidate: null,
      };
    }

    if (typeof pdfParse !== "function") {
      console.error("pdf-parse import failed for file:", fileName);
      return {
        rawText: "",
        lines: [],
        isPSAInvoice: false,
        matchedBy: [],
        textInvoiceCandidate: null,
      };
    }

    const parsed = await pdfParse(buffer);
    const rawText = String(parsed?.text || "");

    const lines = rawText
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/\u00A0/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);

    const headText = lines.slice(0, 50).join(" ").toUpperCase();
    const matchedBy = [];

    if (/\bPSA\b/.test(headText)) matchedBy.push("PSA");
    if (/PSA\s+INDIA/.test(headText)) matchedBy.push("PSA INDIA");
    if (/PSA\s+MUMBAI/.test(headText)) matchedBy.push("PSA MUMBAI");
    if (/PSA\s+SICAL/.test(headText)) matchedBy.push("PSA SICAL");
    if (/PSA\s+AMEYA/.test(headText)) matchedBy.push("PSA AMEYA");

    const sameLinePatterns = [
      /^(?:tax\s+)?invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*(.+)$/i,
      /^(?:bill|document)\s*(?:number|no\.?|#)\s*[:\-]?\s*(.+)$/i,
    ];

    const labelOnlyPatterns = [
      /^(?:tax\s+)?invoice\s*(?:number|no\.?|#)?$/i,
      /^(?:bill|document)\s*(?:number|no\.?|#)?$/i,
    ];

    const candidates = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of sameLinePatterns) {
        const match = line.match(pattern);
        if (match?.[1]) candidates.push(match[1]);
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

    const textInvoiceCandidate = pickBestInvoiceNo(
      candidates.map((value) => ({
        value,
        source: "pdf_text",
      })),
    );

    return {
      rawText,
      lines,
      isPSAInvoice: matchedBy.length > 0,
      matchedBy,
      textInvoiceCandidate,
    };
  } catch (error) {
    console.error("PDF text invoice extraction failed:", {
      fileName,
      error: error?.message || error,
    });

    return {
      rawText: "",
      lines: [],
      isPSAInvoice: false,
      matchedBy: [],
      textInvoiceCandidate: null,
    };
  }
}

function forceLeadingAlphabetForPSA(invoiceNo) {
  const s = cleanInvoiceNoCandidate(invoiceNo);
  if (!s) return s;

  // only act on invoice numbers like 1/2526/045274
  if (!/^[A-Za-z0-9][\/-][A-Za-z0-9]/.test(s)) return s;

  const first = s.charAt(0);
  const rest = s.slice(1);

  const map = {
    "1": "I",
    I: "I",
    l: "I",
    L: "I",
    "|": "I",
    "0": "O",
    O: "O",
    o: "O",
    Q: "O",
    q: "O",
    "5": "S",
    S: "S",
    s: "S",
    "8": "B",
    B: "B",
    b: "B",
    "2": "Z",
    Z: "Z",
    z: "Z",
    "6": "G",
    G: "G",
    g: "G",
  };

  if (!map[first]) return s;
  return `${map[first]}${rest}`;
}

/* ------------------------ retry helpers ------------------------ */

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

/* ------------------------ schemas ------------------------ */

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
    ProformaInvNo: S.str("Proforma Inv No if present."),
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
      "Raw printed vessel/voyage text exactly as seen in the PDF.",
    ),
    rawVesselText: S.str("Raw vessel text."),
    rawVoyageText: S.str("Raw voyage text."),
    vesselName: S.str("Vessel name only."),
    voyageName: S.str("Voyage name/code only."),
    timeOfArrival: S.str(
      "Time/date of arrival in YYYY-MM-DD or datetime only when clearly derivable.",
    ),
    timeOfDeparture: S.str(
      "Time/date of departure in YYYY-MM-DD or datetime only when clearly derivable.",
    ),
    trainNo: S.str("Train number if present."),
    trainArrivalTime: S.str("Train arrival time/date if present."),
    trainDepartureTime: S.str("Train departure time/date if present."),
    ackNo: S.str("Acknowledgement number if present."),
    ackDate: S.str("Acknowledgement date if present."),
    activityCode: S.str("Activity code if present."),
    icfHfm: S.str("ICF/HFM value if present."),

    tblCharges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sNo: S.str("Serial number of the row."),
          serviceGroup: S.str("Grouped section heading."),
          service: S.str("Raw SERVICE column value."),
          serviceDescription: S.str("Actual charge line description."),
          sac: S.str("Raw SAC column value."),
          sacCode: S.str("SAC code."),
          sacPercent: S.str("SAC percentage."),
          qty: S.str("Raw QTY column value."),
          unitQtyPerDay: S.str("Unit quantity per day."),
          uom: S.str("Unit of measure."),
          rate: S.str("Raw RATE column value."),
          tariffRate: S.str("Tariff rate."),
          tariffCurrency: S.str("Tariff currency."),
          exchRate: S.str("Exchange rate."),
          amountInTariffCurrency: S.str("Amount in tariff currency."),
          amountInINR: S.str("Amount in INR."),
          sgst: S.str("SGST amount."),
          cgst: S.str("CGST amount."),
          igst: S.str("IGST amount."),
          tariffCode: S.str("Tariff code."),
          tariff: S.str("Tariff value."),
          exRate: S.str("Exchange rate."),
          exDate: S.str("Exchange date."),
          amount: S.str("Amount."),
          containerNo: S.str("Container number."),
          container: S.str("Container reference."),
          fe: S.str("Full/Empty indicator."),
          size: S.str("Container size."),
          iso: S.str("ISO code."),
          weight: S.str("Weight."),
        },
        required: [],
      },
    },

    chargesTotal: {
      type: "object",
      additionalProperties: false,
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
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          chargeGroup: S.str("Grouped label."),
          no: S.str("Serial number."),
          containerNo: S.str("Container number."),
          container: S.str("Container reference."),
          fe: S.str("Full/Empty indicator."),
          size: S.str("Container size."),
          iso: S.str("ISO code."),
          weight: S.str("Weight."),
          rate: S.str("Rate."),
          tariffCode: S.str("Tariff Code."),
          tariff: S.str("Tariff."),
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

/* ------------------------ prompt builders ------------------------ */

function buildTaskPrompt(fileNames = []) {
  return `
You are a high-accuracy invoice and logistics PDF extraction engine.

Extract data from the provided PDF files and return ONLY valid JSON matching the schema.

Rules:
1. Do not guess values.
2. If a value is not clearly present, return null.
3. Preserve identifier values exactly as printed in the document.
4. Do not change letters into numbers or numbers into letters.
5. Be very careful with visually ambiguous characters like I/1, O/0, B/8, S/5, Z/2, G/6.
6. Extract all visible rows from charges table into tblCharges.
7. Extract all visible rows from container table into tblContainer.
8. Return dates in YYYY-MM-DD only when clearly derivable.
9. Do not invent missing rows or values.

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
- If a field is not visible in this chunk, return null or [] for this chunk.
`;
}

function buildContainerOnlyPrompt(workItem) {
  const fileName = workItem.originalFileName || workItem.displayName || "N/A";

  return `
You are a high-accuracy PDF extraction engine.

Your task is to extract ONLY the container table and container subtotal from this PDF.

Return ONLY valid JSON matching the schema.

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
1. Preserve the invoice number exactly as printed.
2. Do not change letters into numbers or numbers into letters.
3. Be careful with I/1, O/0, B/8, S/5, Z/2, G/6.
4. If not clearly visible, return null.

File name:
${fileName}
`;
}

/* ------------------------ file helpers ------------------------ */

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

async function splitPdfBufferToTempFiles(
  buffer,
  originalName,
  chunkPageCount,
  sharedMeta = {},
) {
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
      ...sharedMeta,
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

    const pdfTextInfo = await extractPdfTextInfo(buffer, displayName);

    console.log("[PSA DETECTION]", {
      file: displayName,
      isPSAInvoice: pdfTextInfo.isPSAInvoice,
      matchedBy: pdfTextInfo.matchedBy,
      pdfTextInvoice: pdfTextInfo.textInvoiceCandidate,
    });

    let pageCount = null;
    try {
      pageCount = await getPdfPageCount(buffer);
    } catch (e) {
      pageCount = null;
    }

    const shouldChunk =
      buffer.length >= BIG_PDF_BYTES ||
      (Number.isFinite(pageCount) && pageCount > BIG_PDF_PAGE_THRESHOLD);

    const sharedMeta = {
      textInvoiceCandidate: pdfTextInfo.textInvoiceCandidate,
      isPSAInvoice: pdfTextInfo.isPSAInvoice,
      psaMatchedBy: pdfTextInfo.matchedBy,
      rawPdfText: pdfTextInfo.rawText,
    };

    if (shouldChunk && Number.isFinite(pageCount) && pageCount > 1) {
      const chunkItems = await splitPdfBufferToTempFiles(
        buffer,
        displayName,
        PDF_CHUNK_PAGE_COUNT,
        sharedMeta,
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
      ...sharedMeta,
    });
  }

  return workItems;
}

/* ------------------------ gemini upload helpers ------------------------ */

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

/* ------------------------ extraction helpers ------------------------ */

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
        ? cleanInvoiceNoCandidate(parsed.invoiceNo)
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

  const response = await withRetry(async () => {
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
  });

  let parsed;

  try {
    parsed = JSON.parse(response.text);
  } catch (jsonError) {
    console.error("Gemini raw response:", response.text);
    throw new Error(`Gemini returned invalid JSON for ${displayName}`);
  }

  parsed = normalizeResultShape(parsed);
  parsed = normalizeVesselVoyageFields(parsed);

  const geminiMainInvoiceRaw = parsed.invoiceNo;
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

  let finalInvoiceNo = pickBestInvoiceNo([
    { value: workItem.textInvoiceCandidate, source: "pdf_text" },
    { value: invoiceFallback?.invoiceNo, source: "gemini_invoice_fallback" },
    { value: geminiMainInvoiceRaw, source: "gemini_main" },
  ]);

  if (workItem.isPSAInvoice && finalInvoiceNo) {
    const before = finalInvoiceNo;
    finalInvoiceNo = forceLeadingAlphabetForPSA(finalInvoiceNo);

    console.log("[PSA NORMALIZATION]", {
      file: displayName,
      isPSAInvoice: workItem.isPSAInvoice,
      matchedBy: workItem.psaMatchedBy || [],
      before,
      after: finalInvoiceNo,
    });
  }

  parsed.invoiceNo = finalInvoiceNo;

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

  console.log("[FINAL INVOICE DECISION]", {
    file: displayName,
    isPSAInvoice: !!workItem.isPSAInvoice,
    matchedBy: workItem.psaMatchedBy || [],
    pdfTextInvoice: workItem.textInvoiceCandidate || null,
    geminiFallbackInvoice: invoiceFallback?.invoiceNo || null,
    geminiMainInvoice: geminiMainInvoiceRaw || null,
    finalInvoiceNo: parsed.invoiceNo || null,
  });

  return {
    parsed,
    usageMetadata: response.usageMetadata || {},
  };
}

/* ------------------------ exports ------------------------ */

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