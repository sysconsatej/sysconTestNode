const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");
const { concat } = require("lodash");

module.exports = {
  insertUpdateBlData: async (req, res) => {
    try {
      const { jsonData, clientId, id } = req.body;
      const pool = await connectToSql();
      const request = pool.request();

      const result = await request
        .input("jsonData", sql.NVarChar(sql.MAX), jsonData)
        .input("clientId", sql.Int, Number(clientId))
        .input("id", sql.Int, Number(id))
        .execute("insertUpdateBlData");

      if (result) {
        res.send({
          success: true,
          message: "Data Fetched Successfully",
          count: result?.length,
          data: result,
        });
      } else {
        res.send({
          success: false,
          message: "No Data Found",
          data: [],
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },
};
