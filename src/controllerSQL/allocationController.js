const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");

module.exports = {
  spSubJobAllocation: async (req, res) => {
    try {
      const {
        clientId,
        companyId,
        companyBranchId,
        businessSegmentId,
        plrId,
        polId,
        podId,
        fpdId,
        trport1,
        masterJobId,
      } = req.body;
      const query = `fetchSubJobAllocation`;
      const parameters = {
        clientId,
        companyId,
        companyBranchId,
        businessSegmentId,
        plrId,
        polId,
        podId,
        fpdId,
        trport1,
        masterJobId,
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
