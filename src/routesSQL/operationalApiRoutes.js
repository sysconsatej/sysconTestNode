const express = require("express");
const router = express.Router();
const operationalApi = require("../controllerSQL/operationalApiController");

router.post("/insertUpdateBlData", operationalApi.insertUpdateBlData);

module.exports = router;
