// const validate = require("../helper/validate");
// const model = require("../models/module");
const jwt = require("jsonwebtoken");
const secretKey = require("../../src/config/auth.config.js");

// const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  ssoLogin: async (req, res) => {
    const token = req.headers["x-access-token"];
    if (!token) {
      return res.status(403).send({
        success: false,
        message: "No token provided!",
        data: [],
      });
    }
    try {
      const decoded = jwt.verify(token, secretKey.secret);
      if (!decoded) {
        return res.status(401).send({
          success: false,
          message: "Unauthorized!",
          data: [],
        });
      }
      res.cookie("token", token, {
        httpOnly: false, // JS cannot access
        secure: false, // HTTPS only
        sameSite: "lax", // allows redirect usage
        path: "/",
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      });

      // return res.redirect(`http://localhost:3001/login`);
      return res.status(200).send({
        success: true,
        message: "SSO login successful, redirected to frontend.",
        redirectUrl: `http://localhost:3001/dashboard`,
      });

      // res.end();
    } catch (error) {
      console.error("Error during SSO login:", error);
      res.status(500).send({
        success: false,
        message: "Internal server error during SSO login.",
        data: [],
      });
    }
  },
};
