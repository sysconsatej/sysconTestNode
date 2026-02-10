const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config");
const { path } = require("pdfkit");

module.exports = {
  ssoLogin: async (req, res) => {
    try {
      const token = req.query?.token;
      const clientCode = req.query?.clientCode || "";
      const userData = req.query?.user;
      const isProd = process.env.NODE_ENV === "production";
      const fallBackUrl = isProd
        ? `http://94.136.187.170:5001/dashboard`
        : `${process.env?.HOST}${process.env?.FRONTEND_PORT}/dashboard`;

      const userType = "user_type_mobile";

      if (!token) {
        return res.status(403).json({
          success: false,
          message: "No SSO token provided",
          data: [],
        });
      }
      const decoded = jwt.verify(token, authConfig.secret);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: "Invalid SSO token",
          data: [],
        });
      }

      const cookiesOptions = {
        domain: isProd ? ".artinshipping.com" : undefined,
        httpOnly: false,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        path: "/",
      };

      res.cookie("token", token, cookiesOptions);

      res.cookie("userType", userType, cookiesOptions);

      res.cookie("userData", userData, cookiesOptions);

      const url = isProd
        ? `https://${clientCode}.artinshipping.com/dashboard`
        : fallBackUrl;

      return res.redirect(url);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "SSO authentication failed",
        data: [],
      });
    }
  },
};
