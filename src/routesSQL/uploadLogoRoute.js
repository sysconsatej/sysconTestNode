const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/uploadLogoController");

router.post("/logoChange", controller.logoChange);


module.exports = router