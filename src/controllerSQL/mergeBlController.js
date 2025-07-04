const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");

module.exports = {
  mergeBl: async (req, res) => {
    try {
      let { vesselId, voyageId, bookingNos, userId, clientId } = req.body;

      if (!vesselId || !voyageId || !bookingNos || !userId || !clientId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const pool = await connectToSql();

      const result = await pool
        .request()
        .input("vesselId", sql.Int, Number(vesselId))
        .input("voyageId", sql.Int, Number(voyageId))
        .input("bookingNo", sql.NVarChar(sql.MAX), bookingNos)
        .input("userId", sql.Int, Number(userId))
        .input("clientId", sql.Int, Number(clientId))
        .execute("insertMergeBl");

      console.log("SP Result:", result);

      if (!result.recordset || result.recordset.length === 0) {
        return res.status(200).json([]);
      }

      const jsonOutput = result.recordset[0]?.JsonData;
      const parsedData = jsonOutput ? JSON.parse(jsonOutput) : [];

      return res.status(200).json(parsedData);
    } catch (error) {
      console.error("SP Error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },
  splitBl: async (req, res) => {
    try {
      let { vesselId, voyageId, bookingNos, userId, clientId } = req.body;

      if (!vesselId || !voyageId || !bookingNos || !userId || !clientId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const pool = await connectToSql();

      const result = await pool
        .request()
        .input("vesselId", sql.Int, Number(vesselId))
        .input("voyageId", sql.Int, Number(voyageId))
        .input("bookingNo", sql.NVarChar(sql.MAX), bookingNos)
        .input("userId", sql.Int, Number(userId))
        .input("clientId", sql.Int, Number(clientId))
        .execute("insertMergeBl");

      console.log("SP Result:", result);

      if (!result.recordset || result.recordset.length === 0) {
        return res.status(200).json([]);
      }

      const jsonOutput = result.recordset[0]?.JsonData;
      const parsedData = jsonOutput ? JSON.parse(jsonOutput) : [];

      return res.status(200).json(parsedData);
    } catch (error) {
      console.error("SP Error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },
};
