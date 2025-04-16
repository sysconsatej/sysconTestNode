const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/accountingReports");

router.post("/balanceSheetReport", controller.fetchDataByStoredProcedure);
router.post("/accountData", controller.fetchBalanceSheetData);
router.post("/fetchData", controller.fetchDataByStoredProcedureAPI);

module.exports = router;
