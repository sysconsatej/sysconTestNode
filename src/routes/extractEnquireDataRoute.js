const express = require("express");
const router = express.Router();

const controller = require("../controller/extractEnquireDataRouteController.js");

router.post("/readEnquire", controller.extractEnquireData);

router.get("/readEnquire/readingStatus", controller.getEnquireExtractionStatus);

module.exports = router;
