const validate = require("../helper/validate");
// const model = require("../models/module");
// const jwt = require("jsonwebtoken");
// const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  ssoLogin: async (req, res) => {
    console.log("SSO Login Request Body:", req.body, req.user);
    try {
      const validationRules = {
        token: "required",
      };

      const validationResult = validate(req.body, validationRules);
      console.log("Request Body:", validationResult);
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Internal Server Error" });
    }
  },
};
