const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/companyDetailsController");

router.post("/logoChange", controller.logoChange);


module.exports = router