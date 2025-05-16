const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  getUserDashboardData: async (req, res) => {
    const { clientId } = req.body;
    try {
      if (!clientId) {
        res
          .status(400)
          .json({ success: false, message: "ClientId is messing!" });
      }
      const resData = await executeStoredProcedure("createDashboardApi", {
        clientId: clientId,
      });
      res.status(200).json({
        success: true,
        message: "Get Create Dashboard Data successfully!",
        data: resData,
      });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  userDashboardSubmit: async (req, res) => {
    const { clientId, userId, companyId, branchId, menuId } = req.body;
    try {
      if (!clientId || !userId || !companyId || !branchId || !menuId) {
        res.status(400).json({
          success: false,
          message:
            "ClientId, userId, companyId, branchId or menuId is messing!",
        });
      }
      const resData = await executeStoredProcedure("createDashboardSubmitApi", {
        clientId,
        userId,
        companyId,
        branchId,
        menuId,
      });
      res.status(200).json({
        success: true,
        message: "Submit user Dashboard Data successfully!",
        data: resData,
      });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  getUserDashboard: async (req, res) => {
    const { userId } = req.body;
    try {
      if (!userId) {
        res.status(400).json({ success: false, message: "userId is messing!" });
      }
      const resData = await executeStoredProcedure("getDashboardApi", {
        userId: userId,
      });
      res.status(200).json({
        success: true,
        message: "User Dashboard Data get successfully!",
        data: resData,
      });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
