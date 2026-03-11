const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");

const { executeQuery } = require("../modelSQL/model");

module.exports = {
  ssoLogin: async (req, res) => {
    try {
      const token = req.query?.token;
      const clientId = req.query?.clientId;
      const isProd = process.env.NODE_ENV === "production";
      const domain = ".artinshipping.com";
      let decoded;

      const fallBackUrl = isProd
        ? "https://syscon.artinshipping.com/dashboard"
        : "http://94.136.187.170:5001/dashboard";

      if (!token) {
        return res.status(403).json({
          success: false,
          message: "No SSO token provided",
          data: [],
        });
      }

      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: "clientId is required",
        });
      }


      try {
        decoded = jwt.verify(token, authConfig.secret);
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired SSO token",
          data: [],
        });
      }

      const query = "SELECT clientCode FROM tblClient WHERE id = @clientId";
      const result = await executeQuery(query, { clientId });
      const clientCode = result?.recordset?.[0]?.clientCode;
      const url = clientCode
        ? isProd
          ? `https://${String(clientCode).toLowerCase()}${domain}/dashboard`
          : "http://94.136.187.170:5001/dashboard"
        : fallBackUrl;

      const cookiesOptions = {
        domain: isProd ? domain : undefined,
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        path: "/",
      };

      res.cookie("token", token, cookiesOptions);

      return res.redirect(url);
    } catch (error) {
      console.error("SSO Login Error:", error);

      return res.status(500).json({
        success: false,

        message: "SSO authentication failed",

        data: [],
      });
    }
  },
};
