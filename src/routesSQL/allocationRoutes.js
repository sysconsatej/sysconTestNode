const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/allocationController");

router.post("/subJobAllocation", controller.spSubJobAllocation);

module.exports = router;
