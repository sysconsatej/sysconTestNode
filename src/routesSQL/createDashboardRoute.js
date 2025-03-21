const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/createDashboardController");

router.post("/getUserDashboardData", controller.getUserDashboardData);
router.post("/userDashboardDataSubmit", controller.userDashboardSubmit);
router.post("/getUserDashboard", controller.getUserDashboard);

module.exports = router;
