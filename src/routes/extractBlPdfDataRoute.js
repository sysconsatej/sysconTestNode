const express = require("express");
const router = express.Router();
const controller = require("../controller/extractBlPdfDataController.js");

router.post("/blPdfData", controller.extractBlPdfData);
router.get("/blPdfData/readingStatus", controller.getBlPdfExtractionStatus);

module.exports = router;
