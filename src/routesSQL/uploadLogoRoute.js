const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/uploadLogoController");

router.post("/logoChange", controller.logoChange);
router.post("/headerAndFooterLogoChange", controller.headerAndFooterLogoChange);

module.exports = router;
