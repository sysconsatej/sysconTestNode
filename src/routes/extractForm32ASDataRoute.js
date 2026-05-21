const express = require("express");
const router = express.Router();
const controller = require("../controller/extractForm32ASDataRouteController.js");

router.post("/form32AsPdfData", controller.extractForm32AsPdfData);
router.get(
  "/form32AsPdfData/readingStatus",
  controller.getForm32AsPdfExtractionStatus,
);

module.exports = router;
