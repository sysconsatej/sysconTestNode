const express = require("express");
const router = express.Router();
const auth = require("../config/auth");
const controller = require("../controller/extractBlPdfDataController.js");

router.post("/blPdfData", auth.verifyToken, controller.extractBlPdfData);
router.get("/blPdfData/readingStatus", auth.verifyToken, controller.getBlPdfExtractionStatus);
router.post("/blPdfData/cancel", auth.verifyToken, controller.cancelBlPdfExtraction);

module.exports = router;
