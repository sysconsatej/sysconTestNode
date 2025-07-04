const controller = require("../controllerSQL/mergeBlController");
const express = require("express");
const router = express.Router();
const auth = require("../config/auth");

router.post("/mergeBl", auth.verifyToken, controller.mergeBl);
router.post("/SplitBl", auth.verifyToken, controller.splitBl);
module.exports = router;
