const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/Reports&spController");
const auth = require("../config/auth");

router.post("/rateRequest", controller.spRateRequest);
router.post("/containerPlanning", controller.spContainerPlanning);

module.exports = router;
