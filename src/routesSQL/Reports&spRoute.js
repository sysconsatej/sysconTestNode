const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/Reports&spController");
const auth = require("../config/auth");

router.post("/rateRequest", controller.spRateRequest);
router.post("/blDataForDO", controller.spBlDataForDO);
router.post("/invoice", controller.spInvoice);
router.post("/vehicleRoute", controller.spVehicleRoute);
router.post("/job", controller.spJob);
router.post("/containerPlanning", controller.spContainerPlanning);
router.post("/getDynamicReportDetails", controller.getDynamicReportDetails);
router.post("/voucher", controller.spVocher);
router.post("/reportTheme", controller.reportTheme);
router.post("/airwaybill", controller.spAirwayBill);
router.post("/saveEditedReport", controller.saveReportData);
router.post("/blconsole", controller.spblconsole);
router.post("/bl", controller.spBl);
router.post("/containerActivity", controller.spContainerActivity);
router.post("/igmBlData", controller.spIgmReport);
router.post("/cargoManifestBldata", controller.spCargoManifestBldata);
router.post("/blProfitability", controller.spBlProfitability);
router.post("/jobProfitability", controller.spJobProfitability);
router.post("/warehouseData", controller.spwarehouseData);
router.post("/blPrint", controller.spBlPrint);

module.exports = router;
