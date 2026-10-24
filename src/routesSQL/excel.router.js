const express = require("express");
const router = express.Router();

const {
    uploadExcelFunc
} = require("../controllerSQL/excel.controller");

router.post("/validate", uploadExcelFunc);

module.exports = router;
