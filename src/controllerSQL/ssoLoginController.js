const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config");

module.exports = {
  ssoLogin: async (req, res) => {
    try {
      const token = req.query?.token;
      const clientCode = String(req?.clientCode).toLowerCase() || "";
      const fallBackUrl = `http://94.136.187.170:5001/dashboard`;

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
      res.cookie("token", token, {
        httpOnly: process.env.NODE_ENV === "production" ? true : false,
        secure: process.env.NODE_ENV === "production" ? true : false,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge: 24 * 60 * 60 * 2,
      });
      const url = clientCode
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
