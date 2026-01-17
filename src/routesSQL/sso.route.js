const express = require("express");
const ssoController = require("../controllerSQL/ssoController");
const auth = require("../config/auth");

const router = express.Router();
router.post("/ssoLogin", auth.verifyToken, ssoController.ssoLogin);
module.exports = router;
