const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { PDFDocument } = require("pdf-lib");
const { GoogleGenAI, createPartFromUri } = require("@google/genai");

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
    vesselName: S.str(
      "Vessel name only. If combined text like 'EVER LIBRA/EVBR2653' is present, extract only 'EVER LIBRA' here when clearly separable.",
    ),
    voyageName: S.str(
      "Voyage name/code only. If combined text like 'EVER LIBRA/EVBR2653' is present, extract only 'EVBR2653' here when clearly separable.",
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

4. Extract all visible rows from the charges table into "tblCharges".
5. Preserve raw printed charge-table columns where available:
   - SERVICE -> service
   - SAC -> sac
   - QTY -> qty
   - UOM -> uom
   - RATE -> rate
   - AMOUNT(INR) -> amountInINR

6. Also map normalized values where clearly possible:
   - serviceDescription from the actual charge line text
   - sacCode from SAC
   - unitQtyPerDay from QTY
   - tariffRate from RATE when RATE is the relevant rate field

7. IMPORTANT FOR GROUPED SERVICE HEADINGS:
   - Some charge tables contain section/group headings inside the SERVICE column.
   - Example: "STEVEDORING/ TERMINAL HANDLING CHARGES (IMPORT -"
   - These headings are not normal charge rows when they do not have their own qty/rate/amount values.
   - Store such headings in "serviceGroup".
   - Repeat the same "serviceGroup" value for each following charge row until the next grouped heading appears.
   - The actual service rows such as "CONTAINER LADEN 20\\"" and "CONTAINER LADEN 40\\"" must remain in "service" and/or "serviceDescription".
   - Do NOT place grouped service headings into tblContainer.

8. If the charges table contains columns such as Tariff Code, Container, Tariff, Ex. Rate, Ex. Date, or Amount, map them into the corresponding fields in "tblCharges".

9. Extract the totals/summary box into "chargesTotal":
   - Actual -> actual
   - Total -> total
   - Advance -> advance
   - Balance Invoice -> balanceInvoice

10. Extract all visible rows from the container details table into "tblContainer".
11. In "tblContainer", keep one object per visible row. Do not merge rows.
12. If the same left-side grouped description applies to multiple rows, repeat it in each row as chargeGroup.
13. If the container table includes extra columns such as Tariff Code, Tariff, Ex. Rate, Ex. Date, Amount, Rate, Weight, ISO, or Container No, map them into the matching fields in "tblContainer".
14. Keep monetary values, codes, dates, and table values exactly as printed in the PDF unless clearly normalizing a date is possible.
15. Return dates in YYYY-MM-DD only when clearly derivable from the document. Otherwise keep the original printed value.
16. Do not invent missing rows, totals, or container values.

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
      sizeBytes: Buffer.byteLength(bytes),
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
              usageMetadataList,
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
