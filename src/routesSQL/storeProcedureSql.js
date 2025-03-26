const controller = require("../controllerSQL/storeProcedureSql");
const express = require("express");
const router = express.Router();
const auth = require("../config/auth");

router.post(
  "/getJobChargeDetails",
  auth.verifyToken,
  controller.getJobChargeDetails
);
router.post("/gettingTaxDetails", auth.verifyToken, controller.gettaxDetails);
router.post("/gettingTdsDetails", auth.verifyToken, controller.getTDSDetails);
module.exports = router;
