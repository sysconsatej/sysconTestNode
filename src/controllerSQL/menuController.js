const validate = require("../helper/validate");
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  getMenuList: async (req, res) => {
    try {
      const { companyId, companyBranchId, userId, clientId } = req.body;
      const query = `menuRetrievalApi`;
      const parameters = {
        companyId,
        companyBranchId,
        userId: req.userId,
        clientId: req.clientId,
      };
      let data = await executeStoredProcedure(query, parameters);

      if (data) {
        res.send({
          success: true,
          message: "Data Fetched Successfully",
          data: data,
        });
      } else {
        res.send({
          success: false,
          message: "No Data Found",
          data: [],
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  menuAccessSubmit: async (req, res) => {
    try {
      const { userId, menu_json, updatedBy } = req.body;

      if (!userId || !menu_json || !updatedBy) {
        return res.status(400).json({
          success: false,
          message: "userId, updatedBy or menu_json is messing!",
        });
      }

      const query = `menuAccessApi`;
      const parameters = {
        userId,
        menu_json,
        updatedBy,
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.status(200).json({
          message: "Menu updated successfully!",
          data: data,
          success: true,
        });
      } else {
        res.status(500).json({
          message: "Data not found!",
          data: data,
          success: false,
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
