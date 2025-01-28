const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/profileController");

router.get("/dropdowns", controller.dropdowns);


module.exports = router