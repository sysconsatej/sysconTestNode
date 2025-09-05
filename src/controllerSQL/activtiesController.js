const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  getActivitiesList: async (req, res) => {
    try {
      const { clientId } = req.body;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: "Client ID is required",
        });
      }
      const query = `activitiesApi`;
      const parameters = { clientId: clientId };
      let data = await executeStoredProcedure(query, parameters);

      if (data) {
        res.status(200).json({
          success: true,
          message: "Data Fetched Successfully",
          data: data,
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  },
  getActivitiesStatusesList: async (req, res) => {
    try {
      const { clientId } = req.body;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          message: "Client ID is required",
        });
      }
      const query = `activitiesStatus`;
      const parameters = { clientId: clientId };
      let data = await executeStoredProcedure(query, parameters);

      if (data) {
        res.status(200).json({
          success: true,
          message: "Data Fetched Successfully",
          data: data,
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  },
};
