const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/notification.controller");
const auth = require("../config/auth");

router.post("/notify", controller.notification);

module.exports = router;
