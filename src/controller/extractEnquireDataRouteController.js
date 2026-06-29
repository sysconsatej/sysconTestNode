const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const GEMINI_MODELS = String(
  process.env.GEMINI_MODELS ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash,gemini-2.5-flash-lite",
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const MAIL_CHUNK_CHARS = Number(process.env.GEMINI_MAIL_CHUNK_CHARS || 45000);
const AUTO_ASYNC_CHARS = Number(process.env.GEMINI_AUTO_ASYNC_CHARS || 120000);
const JOB_EXPIRE_MS = 60 * 60 * 1000;

const extractionJobs = new Map();

function createJobId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function cleanOldJobs() {
  const now = Date.now();

  for (const [jobId, job] of extractionJobs.entries()) {
    if (now - job.createdAt > JOB_EXPIRE_MS) {
      extractionJobs.delete(jobId);
    }
  }
}

function cleanMailText(value = "") {
  return String(value || "")
    .replace(/\[([^\]]+)\]\(mailto:([^)]+)\)/gi, "$2")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildFullEmailText(body = {}) {
  const subject = body.subject || "";
  const from = body.from || body.sender || "";
  const to = body.to || "";
  const date = body.date || "";

  const emailText =
    body.emailText ||
    body.emailBody ||
    body.mailBody ||
    body.body ||
    body.mailData ||
    "";

  const emailHtml = body.emailHtml || body.html || "";

  const finalBody = emailText || emailHtml;

  return cleanMailText(
    [
      subject ? `Subject: ${subject}` : "",
      from ? `From: ${from}` : "",
      to ? `To: ${to}` : "",
      date ? `Date: ${date}` : "",
      "",
      finalBody,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function splitText(text = "", chunkSize = MAIL_CHUNK_CHARS) {
  const value = String(text || "");

  if (!value) return [];
  if (value.length <= chunkSize) return [value];

  const chunks = [];
  let start = 0;

  while (start < value.length) {
    let end = Math.min(start + chunkSize, value.length);

    const lastBreak = value.lastIndexOf("\n\n", end);

    if (lastBreak > start + chunkSize * 0.5) {
      end = lastBreak;
    }

    const part = value.slice(start, end).trim();

    if (part) chunks.push(part);

    start = end;
  }

  return chunks;
}

function parseGeminiJson(text) {
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  let cleaned = String(text).trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const num = Number(String(value).replace(/,/g, "").trim());

  return Number.isFinite(num) ? num : null;
}

function buildExtractionPrompt(mailText, mode = "single") {
  return `
You are a logistics and shipping booking enquiry extraction engine.

Extract booking creation data from the given email.

Important:
- Use only the given email content.
- Do not guess unavailable values.
- Return only valid JSON.
- Do not return markdown.
- Do not add comments.
- If value is not available, return null.
- If list is not available, return [].

Mode: ${mode}

Return JSON in exactly this structure:

{
  "success": true,
  "documentType": "shipping_enquiry_email",
  "bookingCreationReady": false,
  "bookingData": {
    "shipmentType": null,
    "mode": null,
    "origin": {
      "raw": null,
      "portName": null,
      "city": null,
      "country": null
    },
    "destination": {
      "raw": null,
      "portName": null,
      "city": null,
      "country": null
    },
    "cargoDetails": null,
    "commodity": null,
    "containerType": null,
    "fclLcl": null,
    "grossWeight": {
      "value": null,
      "unit": null,
      "raw": null
    },
    "volume": {
      "value": null,
      "unit": null,
      "raw": null
    },
    "readyDate": {
      "raw": null,
      "iso": null
    },
    "requiredService": [],
    "requestedDetails": {
      "transitTime": false,
      "vesselSchedule": false,
      "freightCharges": false,
      "localCharges": false,
      "documentationRequirements": false,
      "otherTerms": false
    },
    "remarks": null
  },
  "customerDetails": {
    "contactName": null,
    "companyName": null,
    "mobileNo": null,
    "email": null
  },
  "bookingPayload": {
    "shipmentType": null,
    "mode": null,
    "polName": null,
    "podName": null,
    "originText": null,
    "destinationText": null,
    "cargoDescription": null,
    "commodity": null,
    "containerType": null,
    "grossWeight": null,
    "grossWeightUnit": null,
    "volumeCbm": null,
    "readyDate": null,
    "requiredService": null,
    "customerName": null,
    "customerCompanyName": null,
    "customerEmail": null,
    "customerMobileNo": null,
    "remarks": null
  },
  "missingFields": [],
  "confidence": 0
}

Rules:
1. shipmentType should be Import, Export, Domestic, or null.
2. mode should be Sea, Air, Road, Rail, Courier, or null.
3. Origin POL should be extracted from Origin.
4. Destination POD should be extracted from Destination.
5. Example: "Nhava Sheva, Mumbai, India" means portName can be "Nhava Sheva", city "Mumbai", country "India".
6. Example: "Jebel Ali Port, Dubai, UAE" means portName can be "Jebel Ali Port", city "Dubai", country "UAE".
7. Convert "12,500 KGS" to value 12500 and unit "KGS".
8. Convert "28 CBM" to value 28 and unit "CBM".
9. Convert ready date to YYYY-MM-DD if possible.
10. requiredService must be array.
11. bookingPayload must be flat and ready to insert into Booking form/API.
12. missingFields must contain important fields that are not available.
13. confidence must be between 0 and 1.

Email content:
${mailText}
`;
}

function buildMergePrompt(partials) {
  return `
You are merging partial extracted shipping enquiry JSON results.

Merge all partial JSON objects into one final JSON object.
Use the same JSON structure.
Prefer non-null values.
Do not guess missing values.
Return only valid JSON.

Partial results:
${JSON.stringify(partials, null, 2)}
`;
}

async function callGeminiWithFallback(prompt) {
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      return {
        model,
        text: response.text,
        usageMetadata: response.usageMetadata || null,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Gemini extraction failed");
}

function normalizeFinalResult(result = {}) {
  const bookingData = result.bookingData || {};
  const customerDetails = result.customerDetails || {};

  const origin = bookingData.origin || {};
  const destination = bookingData.destination || {};
  const grossWeight = bookingData.grossWeight || {};
  const volume = bookingData.volume || {};

  const requiredService = Array.isArray(bookingData.requiredService)
    ? bookingData.requiredService
    : bookingData.requiredService
      ? [bookingData.requiredService]
      : [];

  const bookingPayload = {
    shipmentType: bookingData.shipmentType || null,
    mode: bookingData.mode || null,

    polName: origin.portName || origin.raw || null,
    podName: destination.portName || destination.raw || null,

    originText: origin.raw || null,
    destinationText: destination.raw || null,

    cargoDescription: bookingData.cargoDetails || null,
    commodity: bookingData.commodity || bookingData.cargoDetails || null,
    containerType: bookingData.containerType || null,

    grossWeight: toNumber(grossWeight.value),
    grossWeightUnit: grossWeight.unit || null,

    volumeCbm: toNumber(volume.value),

    readyDate: bookingData.readyDate?.iso || bookingData.readyDate?.raw || null,

    requiredService: requiredService.join(", ") || null,

    customerName: customerDetails.contactName || null,
    customerCompanyName: customerDetails.companyName || null,
    customerEmail: customerDetails.email || null,
    customerMobileNo: customerDetails.mobileNo || null,

    remarks: bookingData.remarks || null,
  };

  const missingFields = [];

  if (!bookingPayload.shipmentType) missingFields.push("shipmentType");
  if (!bookingPayload.mode) missingFields.push("mode");
  if (!bookingPayload.originText) missingFields.push("origin");
  if (!bookingPayload.destinationText) missingFields.push("destination");
  if (!bookingPayload.cargoDescription) missingFields.push("cargoDetails");
  if (!bookingPayload.containerType) missingFields.push("containerType");
  if (!bookingPayload.grossWeight) missingFields.push("grossWeight");
  if (!bookingPayload.readyDate) missingFields.push("readyDate");

  return {
    success: true,
    documentType: result.documentType || "shipping_enquiry_email",
    bookingCreationReady: missingFields.length === 0,
    bookingData,
    customerDetails,
    bookingPayload,
    missingFields,
    confidence:
      typeof result.confidence === "number"
        ? result.confidence
        : missingFields.length === 0
          ? 0.9
          : 0.7,
  };
}

async function extractBookingDataFromMail(mailText) {
  const chunks = splitText(mailText);
  const usageMetadata = [];

  if (chunks.length <= 1) {
    const prompt = buildExtractionPrompt(mailText, "single_email");
    const geminiResponse = await callGeminiWithFallback(prompt);

    usageMetadata.push(geminiResponse.usageMetadata);

    const json = parseGeminiJson(geminiResponse.text);
    const finalResult = normalizeFinalResult(json);

    return {
      ...finalResult,
      meta: {
        modelUsed: geminiResponse.model,
        chunksProcessed: 1,
        usageMetadata: usageMetadata.filter(Boolean),
      },
    };
  }

  const partialResults = [];
  let modelUsed = null;

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildExtractionPrompt(
      chunks[i],
      `chunk_${i + 1}_of_${chunks.length}`,
    );

    const geminiResponse = await callGeminiWithFallback(prompt);

    modelUsed = modelUsed || geminiResponse.model;
    usageMetadata.push(geminiResponse.usageMetadata);

    const json = parseGeminiJson(geminiResponse.text);
    partialResults.push(json);
  }

  const mergePrompt = buildMergePrompt(partialResults);
  const mergeResponse = await callGeminiWithFallback(mergePrompt);

  usageMetadata.push(mergeResponse.usageMetadata);

  const mergedJson = parseGeminiJson(mergeResponse.text);
  const finalResult = normalizeFinalResult(mergedJson);

  return {
    ...finalResult,
    meta: {
      modelUsed: mergeResponse.model || modelUsed,
      chunksProcessed: chunks.length,
      usageMetadata: usageMetadata.filter(Boolean),
    },
  };
}

async function runExtractionJob(jobId, mailText) {
  const job = extractionJobs.get(jobId);

  if (!job) return;

  try {
    job.status = "processing";
    job.startedAt = new Date().toISOString();

    extractionJobs.set(jobId, job);

    const result = await extractBookingDataFromMail(mailText);

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.result = result;
    job.error = null;

    extractionJobs.set(jobId, job);
  } catch (err) {
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    job.result = null;
    job.error = err.message || "Extraction failed";

    extractionJobs.set(jobId, job);
  }
}

module.exports = {
  extractEnquireData: async (req, res) => {
    try {
      cleanOldJobs();

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          message: "GEMINI_API_KEY is missing",
        });
      }

      const mailText = buildFullEmailText(req.body || {});

      if (!mailText) {
        return res.status(400).json({
          success: false,
          message:
            "Email data is required. Pass emailText, emailBody, mailBody, body, or mailData.",
        });
      }

      const forceAsync =
        req.body?.async === true ||
        req.body?.async === "true" ||
        req.body?.runAsync === true ||
        req.body?.runAsync === "true";

      const shouldRunAsync = forceAsync || mailText.length > AUTO_ASYNC_CHARS;

      if (shouldRunAsync) {
        const jobId = createJobId();

        extractionJobs.set(jobId, {
          jobId,
          status: "queued",
          createdAt: Date.now(),
          createdAtIso: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          result: null,
          error: null,
        });

        setImmediate(() => {
          runExtractionJob(jobId, mailText);
        });

        return res.status(202).json({
          success: true,
          message: "Enquiry extraction started",
          jobId,
          status: "queued",
          readingStatusUrl: `/api/readEnquire/readingStatus?jobId=${jobId}`,
        });
      }

      const result = await extractBookingDataFromMail(mailText);

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to extract enquiry data",
      });
    }
  },

  getEnquireExtractionStatus: async (req, res) => {
    try {
      cleanOldJobs();

      const jobId = req.query.jobId || req.body?.jobId;

      if (!jobId) {
        return res.status(400).json({
          success: false,
          message: "jobId is required",
        });
      }

      const job = extractionJobs.get(jobId);

      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Extraction job not found or expired",
        });
      }

      return res.status(200).json({
        success: true,
        jobId,
        status: job.status,
        createdAt: job.createdAtIso,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result,
        error: job.error,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to get extraction status",
      });
    }
  },
};
