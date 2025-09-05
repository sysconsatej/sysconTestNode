const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/reportsController");
const auth = require("../config/auth");

router.post("/reportData", controller.getReportsData);
router.post("/insertUpdateData", controller.insertUpdateData);
router.post("/insertUpdateRecordData", controller.insertUpdateRecordData);
router.post("/reportSearchCriteria", controller.reportSearchCriteriaApi);
router.post("/rp-app", controller.reportSearchCriteriaAppApi);
router.post("/getGLChargeDetails", controller.getGLChargeDetails);

module.exports = router;
