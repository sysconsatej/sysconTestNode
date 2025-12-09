const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/accountingReports");

router.post("/trialBalanceReportData", controller.trialBalanceReportData);
router.post("/balanceSheetReportData", controller.balanceSheetReportData);
router.post("/accountData", controller.fetchBalanceSheetData);
router.post("/fetchData", controller.fetchDataByStoredProcedureAPI);
router.post("/ledgerReportData", controller.ledgerReportData);

module.exports = router;
