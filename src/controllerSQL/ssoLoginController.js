const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config");

module.exports = {
  ssoLogin: async (req, res) => {
    try {
      const token = req.query?.token;
      const clientCode = req.query?.clientCode || "";
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
        domain: ".artinshipping.com",
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
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
