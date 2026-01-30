const express = require("express");
const ssoController = require("../controllerSQL/ssoLoginController");
// const auth = require("../config/auth");

const router = express.Router();
router.get("/sso-login",  ssoController.ssoLogin);
module.exports = router;
