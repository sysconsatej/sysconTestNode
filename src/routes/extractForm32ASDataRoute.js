const express = require("express");
const router = express.Router();
const auth = require("../config/auth");
const controller = require("../controller/extractForm32ASDataRouteController.js");

router.post("/form32AsPdfData", auth.verifyToken, controller.extractForm32AsPdfData);
router.get(
  "/form32AsPdfData/readingStatus",
  auth.verifyToken,
  controller.getForm32AsPdfExtractionStatus,
);
router.post(
  "/form32AsPdfData/cancel",
  auth.verifyToken,
  controller.cancelForm32AsPdfExtraction,
);

module.exports = router;
