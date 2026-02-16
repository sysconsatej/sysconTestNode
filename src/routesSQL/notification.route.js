const express = require("express");
const router = express.Router();
const {
  notification,
  saveDeviceToken,
} = require("../controllerSQL/notification.controller");
const { verifyToken } = require("../config/auth");

router.post("/notify", notification);
router.post("/save-device-token", verifyToken, saveDeviceToken);

module.exports = router;
