const controller = require("../controllerSQL/storeProcedureSql");
const express = require("express");
const router = express.Router();
const auth = require("../config/auth");

router.post(
  "/getJobChargeDetails",
  auth.verifyToken,
  controller.getJobChargeDetails
);
router.post("/gettingTaxDetails", auth.verifyToken, controller.gettaxDetails);
router.post("/gettingTdsDetails", auth.verifyToken, controller.getTDSDetails);
router.post("/getGeneralLedgerData", auth.verifyToken, controller.getGeneralLedgerData);
router.post("/getVoucherData", auth.verifyToken, controller.getVoucherData);
router.post("/getBlChargeDetails", auth.verifyToken, controller.getBlChargeDetails);
router.post("/gettingTaxDetailsQuotation", auth.verifyToken, controller.getTaxDetailsQuotation);
router.post("/gettingcontainerActivity", auth.verifyToken, controller.getcontainerActivity);
router.post("/getContainerChargeDetails", auth.verifyToken, controller.getContainerChargeDetails);
router.post("/getThirdLevelDetails", auth.verifyToken, controller.getThirdLevelDetails);
router.post("/saveContainerActivity", auth.verifyToken, controller.saveContainerMovement);
router.post("/getGeneralLegerBillingParty", auth.verifyToken, controller.generalLegerBillingParty);
router.post("/getDetentionDetails", auth.verifyToken, controller.getDetentionDetails);
router.post("/getThirdLevelPurchaseContainerWise", auth.verifyToken, controller.getThirdLevelPurchaseContainerWise);
router.post("/calculateDetentionRate", auth.verifyToken, controller.calculateDetentionRate);
router.post("/getThirdLevelDetailsPurchase", auth.verifyToken, controller.getThirdLevelDetailsPurchase);
router.post("/fetchContainerDropdownData", auth.verifyToken, controller.fetchContainerDropdownData);


router.post("/getVoucher",auth.verifyToken,controller.getVoucher);

module.exports = router;
