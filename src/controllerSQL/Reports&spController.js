const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");

module.exports = {
  spRateRequest: async (req, res) => {
    try {
      const { id, clientId } = req.body;
      const query = `spRateRequest`;
      const parameters = {
        id,
        clientId,
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.send({
          success: true,
          message: "Data Fetched Successfully",
          count: data.length,
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
  spContainerPlanning: async (req, res) => {
    try {
      const { fromDate, toDate, clientId } = req.body;
      const query = `spContainerPlanning`;
      const parameters = {
        fromDate,
        toDate,
        clientId,
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.send({
          success: true,
          message: "Data Fetched Successfully",
          count: data.length,
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
