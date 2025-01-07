const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/reportsController");
const auth = require("../config/auth");

router.post("/reportData", controller.getReportsData);
router.post("/insertUpdateData", controller.insertUpdateData);

module.exports = router;
