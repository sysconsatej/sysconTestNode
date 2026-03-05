const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config");
const { executeQuery } = require("../modelSQL/model");

module.exports = {
  ssoLogin: async (req, res) => {
    try {
      const token = req.query?.token;
      const clientId = req.query?.clientId || "";
      // const isProduction = process.env.NODE_ENV === "production";
      // const fallBackUrl =  isProduction ? "http://94.136.187.170:5001/dashboard" : `${process.env.FRONTEND_URL}/dashboard`;
      const query = "SELECT clientCode FROM tblClient WHERE id = @clientId";
      const result = await executeQuery(query, { clientId: clientId });
      const clientCode = result?.recordset[0]?.clientCode || "";

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
      const url = clientCode
        ? `https://${String(clientCode).toLocaleLowerCase()}.artinshipping.com/dashboard`
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
