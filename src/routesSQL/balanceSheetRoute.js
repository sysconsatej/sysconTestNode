const controller = require("../controllerSQL/BalanceSheet");
const express = require("express");
const router = express.Router();
const auth = require("../config/auth");

router.post("/balanceSheetReport", auth.verifyToken, controller.BalanceSheetSp);

module.exports = router;
