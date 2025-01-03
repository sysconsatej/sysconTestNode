const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  getReportsData: async (req, res) => {
    try {
      const { columns, tableName, whereCondition, clientIdCondition } =
        req.body;
      const query = `fetchDataForReports`;
      const parameters = {
        columns,
        tableName,
        whereCondition,
        clientIdCondition,
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
        message: "Something went wrong",
        data: error.message,
      });
    }
  },
};
