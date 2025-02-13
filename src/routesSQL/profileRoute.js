const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/profileController");

router.post("/dropdowns", controller.dropdowns);
router.post("/profileSubmit", controller.profileSubmit);



module.exports = router