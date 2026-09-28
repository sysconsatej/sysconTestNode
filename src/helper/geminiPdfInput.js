const fs = require("fs/promises");
const { createPartFromUri } = require("@google/genai");

// Gemini accepts requests up to 20 MB, and inline data is base64 encoded
// (~33% larger), so PDFs up to this size can be sent inside the request.
// That skips the Files API upload and the wait for the file to become ACTIVE.
const INLINE_PDF_MAX_BYTES = Number(
  process.env.GEMINI_INLINE_PDF_MAX_BYTES || 10 * 1024 * 1024,
);

function canSendPdfInline(sizeBytes) {
  return Number(sizeBytes) > 0 && Number(sizeBytes) <= INLINE_PDF_MAX_BYTES;
}

// source: a Buffer or a local file path. Returns an object usable wherever a
// Files API file is used (see toPdfPart).
async function readInlinePdf(source) {
  const buffer = Buffer.isBuffer(source) ? source : await fs.readFile(source);

  return {
    state: "ACTIVE",
    mimeType: "application/pdf",
    inlineData: {
      mimeType: "application/pdf",
      data: buffer.toString("base64"),
    },
  };
}

// Content part for either an inline PDF or an uploaded Files API file.
function toPdfPart(file) {
  if (file?.inlineData) {
    return { inlineData: file.inlineData };
  }

  return createPartFromUri(file.uri, file.mimeType);
}

// Runs worker(item, index) for every item, at most `concurrency` at a time,
// and returns the results in the original order. If any worker fails, no new
// items are started, running ones are allowed to finish (so their cleanup
// runs), and the first error is thrown.
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;

  async function runNext() {
    while (!firstError && nextIndex < items.length) {
      const index = nextIndex++;

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        firstError = firstError || error;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));

  if (firstError) {
    throw firstError;
  }

  return results;
}

module.exports = {
  canSendPdfInline,
  readInlinePdf,
  toPdfPart,
  mapWithConcurrency,
};
