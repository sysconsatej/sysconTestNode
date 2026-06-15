const router = require('express').Router();
const { verifyToken } = require("../config/auth");
const { getCustomerQuotationData } = require("../controllerSQL/customer-quotation.controller");


router.get("/get-customer-quotation-data", verifyToken, getCustomerQuotationData);

module.exports = router;