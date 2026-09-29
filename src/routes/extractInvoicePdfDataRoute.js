const express = require("express");
const router = express.Router();
const auth = require("../config/auth");
const controller = require("../controller/extractInvoicePdfDataController");

router.post("/pdfData", auth.verifyToken, controller.extractPdfData);
router.get("/pdfData/readingStatus", auth.verifyToken, controller.getPdfExtractionStatus);
router.post("/pdfData/cancel", auth.verifyToken, controller.cancelPdfExtraction);

module.exports = router;