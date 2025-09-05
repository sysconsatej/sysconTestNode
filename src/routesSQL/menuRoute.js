const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/menuController");
const auth = require("../config/auth");

router.post("/list", auth.verifyToken, controller.getMenuList);
router.post("/menuAccessSubmit", auth.verifyToken, controller.menuAccessSubmit);

module.exports = router;
