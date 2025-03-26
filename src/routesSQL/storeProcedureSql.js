const controller = require("../controllerSQL/storeProcedureSql");
const express = require("express");
const router = express.Router();
const auth = require("../config/auth");

router.post(
  "/getJobChargeDetails",
  auth.verifyToken,
  controller.getJobChargeDetails
);

module.exports = router;
