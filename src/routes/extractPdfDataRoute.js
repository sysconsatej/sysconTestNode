const express = require("express");
const router = express.Router();
const controller = require("../controller/extractPdfDataController");

router.post("/pdfData", controller.extractPdfData);
router.get("/pdfData/readingStatus", controller.getPdfExtractionStatus);

module.exports = router;