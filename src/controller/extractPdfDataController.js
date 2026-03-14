const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { GoogleGenAI, createPartFromUri } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_PDF_BYTES = 50 * 1024 * 1024; // 50 MB per PDF

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
    vesselName: S.str("Vessel name if present."),
    voyageName: S.str("Voyage name if present."),
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
      description: "Charge/tariff rows extracted from the invoice table.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sNo: S.str("Serial number of the row."),
          serviceDescription: S.str("Service description."),
          sacCode: S.str("SAC code."),
          sacPercent: S.str("SAC percentage."),
          unitQtyPerDay: S.str("Unit quantity per day."),
          tariffRate: S.str("Tariff rate."),
          tariffCurrency: S.str("Tariff currency."),
          exchRate: S.str("Exchange rate."),
          amountInTariffCurrency: S.str("Amount in tariff currency."),
          sgst: S.str("SGST amount."),
          cgst: S.str("CGST amount."),
          igst: S.str("IGST amount."),
          amountInINR: S.str("Amount in INR."),
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
          fe: S.str("Full/Empty indicator, usually F or E."),
          size: S.str("Container size, for example 20 or 40."),
          iso: S.str("ISO code, for example 22G1."),
          weight: S.str("Container weight as printed in the PDF."),
          rate: S.str("Rate as printed in the PDF."),
          tariffCode: S.str("Tariff Code"),
          tariff: S.str("Tariff $ / ₹"),
          exRate: S.str("Ex. Rate"),
          exDate: S.str("Ex. Date"),
          amount: S.str("Amount"),
        },
        required: [],
      },
    },

    containerTotal: {
      type: "object",
      additionalProperties: false,
      description: "Invoice Sub Total After the container table.",
      properties: {
        containerSubTotal: S.str("Sub Total"),
      },
    },
  },
};

// function buildTaskPrompt(fileNames = []) {
//   return `
// You are a high-accuracy invoice and logistics PDF extraction engine.

// Extract data from the provided PDF files and return ONLY valid JSON matching the schema.

// Rules:
// 1. Do not guess values.
// 2. If a value is not clearly present, return null.
// 3. Map labels intelligently. For example:
//    - invoiceNo may appear as Invoice No, Tax Invoice No, Bill No, Document No
//    - invoiceDate may appear as Invoice Date, Bill Date, Document Date
//    - CustomerCode may appear as Customer Code, Client Code, Party Code
//    - CustomerName may appear as Buyer Name, Customer Name, Party Name
//    - gstinNo may appear as GSTIN, GST No, GSTIN/UIN
//    - irnNo may appear as IRN, Invoice Reference Number
//    - poNo may appear as PO No, Purchase Order No
//    - VesselCallNo may appear as Vessel Call No, Call No
//    - vesselName may appear as Vessel, Vessel Name
//    - ackNo may appear as Ack No, Acknowledgement No
//    - ackDate may appear as Ack Date, Acknowledgement Date
// 4. Extract all rows from the charges table into "tblCharges".
// 5. Extract the totals/summary box into "chargesTotal":
//    - Actual -> actual
//    - Total -> total
//    - Advance -> advance
//    - Balance Invoice -> balanceInvoice
// 6. Extract all rows from the container details table into "tblContainer".
// 7. In tblContainer keep one object per visible row. Do not merge rows.
// 8. If the same left-side grouped description applies to multiple rows, repeat it in each row as chargeGroup.
// 9. Keep monetary values and table values exactly as printed in the PDF.
// 10. Use warnings for conflicting values.
// 11. Use missingFields for important fields that are not found.
// 12. Set reviewRequired to true if key fields like invoiceNo, invoiceDate, CustomerName, or gstinNo are missing or ambiguous.
// 13. Return dates in YYYY-MM-DD only when clearly derivable from the document. Otherwise keep the original printed value if it includes time/table content.

// File names:
// ${fileNames.join(", ") || "N/A"}
// `;
// }

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
5. If the charges table contains columns such as Tariff Code, Container, Tariff, Ex. Rate, Ex. Date, or Amount, map them into the corresponding fields in "tblCharges".
6. Extract the totals/summary box into "chargesTotal":
   - Actual -> actual
   - Total -> total
   - Advance -> advance
   - Balance Invoice -> balanceInvoice

7. Extract all visible rows from the container details table into "tblContainer".
8. In "tblContainer", keep one object per visible row. Do not merge rows.
9. If the same left-side grouped description applies to multiple rows, repeat it in each row as chargeGroup.
10. If the container table includes extra columns such as Tariff Code, Tariff, Ex. Rate, Ex. Date, Amount, Rate, Weight, ISO, or Container No, map them into the matching fields in "tblContainer".
11. Keep monetary values, codes, dates, and table values exactly as printed in the PDF unless clearly normalizing a date is possible.
12. Return dates in YYYY-MM-DD only when clearly derivable from the document. Otherwise keep the original printed value.
13. Do not invent missing rows, totals, or container values.

File names:
${fileNames.join(", ") || "N/A"}
`;
}

/**
 * express-fileupload support
 * req.files.file => single file object
 * req.files.file => array of file objects when multiple uploaded with same key
 * req.files can also contain multiple keys
 */
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
  if (file.data && Buffer.isBuffer(file.data)) {
    return file.data;
  }

  if (file.tempFilePath) {
    return await fs.readFile(file.tempFilePath);
  }

  return null;
}

async function ensureUploadInput(file) {
  if (file.tempFilePath) {
    return {
      uploadInput: file.tempFilePath,
      cleanup: async () => {},
    };
  }

  const buffer = await getFileBuffer(file);

  if (!buffer) {
    throw new Error(
      `Could not read uploaded file buffer for ${file.name || "unknown file"}`,
    );
  }

  const tempName = `${Date.now()}-${crypto.randomUUID()}-${file.name || "upload.pdf"}`;
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

async function uploadAndWaitForFile(file, index, totalFiles) {
  const displayName = file.name || `file-${index + 1}.pdf`;
  let cleanupLocalFile = async () => {};

  try {
    setReadingStatus({
      status: "running",
      stage: "reading_local_file",
      progress: Math.min(15 + index * 5, 25),
      currentFileIndex: index + 1,
      totalFiles,
      currentFileName: displayName,
      message: `Reading ${displayName} from server`,
      error: null,
    });

    const { uploadInput, cleanup } = await ensureUploadInput(file);
    cleanupLocalFile = cleanup;

    setReadingStatus({
      status: "running",
      stage: "uploading_to_gemini",
      progress: Math.min(25 + index * 10, 45),
      currentFileIndex: index + 1,
      totalFiles,
      currentFileName: displayName,
      message: `Uploading ${displayName} to Gemini`,
      error: null,
    });

    const uploaded = await ai.files.upload({
      file: uploadInput,
      config: {
        mimeType: "application/pdf",
        displayName,
      },
    });

    let fetchedFile = await ai.files.get({ name: uploaded.name });
    let pollCounter = 0;

    while (safeFileState(fetchedFile.state) === "PROCESSING") {
      const loopProgressBase =
        45 + Math.floor((index / Math.max(totalFiles, 1)) * 25);
      const loopProgress = Math.min(
        loopProgressBase + Math.min(pollCounter * 2, 15),
        70,
      );

      setReadingStatus({
        status: "running",
        stage: "gemini_processing_file",
        progress: loopProgress,
        currentFileIndex: index + 1,
        totalFiles,
        currentFileName: displayName,
        fileState: safeFileState(fetchedFile.state),
        message: `Gemini is processing ${displayName}`,
        error: null,
      });

      await sleep(2000);
      fetchedFile = await ai.files.get({ name: uploaded.name });
      pollCounter += 1;
    }

    if (safeFileState(fetchedFile.state) === "FAILED") {
      throw new Error(`Gemini failed to process file: ${displayName}`);
    }

    setReadingStatus({
      status: "running",
      stage: "gemini_file_ready",
      progress: Math.min(60 + Math.floor(((index + 1) / totalFiles) * 15), 75),
      currentFileIndex: index + 1,
      totalFiles,
      currentFileName: displayName,
      fileState: safeFileState(fetchedFile.state),
      message: `${displayName} is ready for extraction`,
      error: null,
    });

    return {
      fetchedFile,
      uploadedName: uploaded.name,
    };
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

      const invalidFile = files.find(
        (f) => (f.mimetype || "").toLowerCase() !== "application/pdf",
      );

      if (invalidFile) {
        return res.status(400).json({
          success: false,
          error: `Only PDF files are allowed. Invalid file: ${
            invalidFile.name || "unknown"
          }`,
        });
      }

      const oversizeFile = files.find(
        (f) => Number(f.size || 0) > MAX_PDF_BYTES,
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

          const readyFiles = [];

          for (let i = 0; i < files.length; i++) {
            const { fetchedFile, uploadedName } = await uploadAndWaitForFile(
              files[i],
              i,
              files.length,
            );

            readyFiles.push(fetchedFile);
            uploadedGeminiNames.push(uploadedName);
          }

          setReadingStatus({
            status: "running",
            stage: "generating_content",
            progress: 80,
            message: "Sending processed PDFs to Gemini for extraction",
            error: null,
          });

          const contents = [
            buildTaskPrompt(files.map((f) => f.name).filter(Boolean)),
            ...readyFiles
              .filter((file) => file && file.uri && file.mimeType)
              .map((file) => createPartFromUri(file.uri, file.mimeType)),
          ];

          const response = await ai.models.generateContent({
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

          setReadingStatus({
            status: "running",
            stage: "parsing_response",
            progress: 95,
            message: "Parsing Gemini response JSON",
            error: null,
          });

          let parsed;
          try {
            parsed = JSON.parse(response.text);
          } catch (jsonError) {
            console.error("Gemini raw response:", response.text);
            throw new Error("Gemini returned invalid JSON");
          }

          setReadingStatus({
            status: "completed",
            stage: "completed",
            progress: 100,
            message: "PDF data extracted successfully",
            data: {
              ...parsed,
              usageMetadata: response.usageMetadata || {},
            },
            error: null,
          });
        } catch (error) {
          console.error("Error extracting PDF data:", error);

          setReadingStatus({
            status: "failed",
            stage: "failed",
            progress: 100,
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
