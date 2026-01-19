const express = require("express");
const ssoController = require("../controllerSQL/ssoController");
const auth = require("../config/auth");

const router = express.Router();
router.get("/sso-login", auth.verifyToken, ssoController.ssoLogin);
module.exports = router;
