const express = require('express');
const router = express.Router();
const controller = require('../controllerSQL/eInvoicingCon.js');
const auth = require('../config/auth');

router.post('/generateIRN',auth.verifyToken,controller.generateIRN)
router.post('/isEInvoicing',auth.verifyToken,controller.isEInvoicing)
// router.post('/eInvoicingGSTHero',auth.verifyToken,controller.eInvoicingGSTHero)

module.exports=router