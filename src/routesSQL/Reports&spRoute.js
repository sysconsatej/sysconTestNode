const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/Reports&spController");
const auth = require("../config/auth");

router.post("/rateRequest", controller.spRateRequest);
router.post("/invoice", controller.spInvoice);
router.post("/job", controller.spJob);
router.post("/containerPlanning", controller.spContainerPlanning);
router.post("/getDynamicReportDetails", controller.getDynamicReportDetails);
router.post("/voucher", controller.spVocher);
router.post("/reportTheme", controller.reportTheme);

module.exports = router;
