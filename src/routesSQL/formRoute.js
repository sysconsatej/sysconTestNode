const express = require("express");
const router = express.Router();
const controller = require("../controllerSQL/formController");
const auth = require("../config/auth");

router.get("/list", auth.verifyToken, controller.listControlToDrawScreen);
router.post("/DropDownList", auth.verifyToken, controller.filterdDropDown);
router.post(
  "/DropDownListCreateForm",
  auth.verifyToken,
  controller.dropdownCreateForm
);
router.post("/dynamicFetch", auth.verifyToken, controller.dynamicFetch);
router.post("/FormList", auth.verifyToken, controller.formList);
router.post("/add", auth.verifyToken, controller.CreateFormControl);
router.post("/getCopyData", auth.verifyToken, controller.getCopyData);
router.post("/disableEdit", auth.verifyToken, controller.disableEdit);
router.post("/disablePrint", auth.verifyToken, controller.validatePrint);
router.post("/disableAdd", auth.verifyToken, controller.disableAdd);
router.post("/validateSubmit", auth.verifyToken, controller.validateSubmit);
router.post("/tallyDebitCredit", auth.verifyToken, controller.tallyDebitCredit);
module.exports = router;
