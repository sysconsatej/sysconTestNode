const express = require("express");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

module.exports = {
  fetchDataByStoredProcedure: async (req, res) => {
    const { fromDate, toDate, branchId } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const pool = await connectToSql();

      // Pass parameters with the correct SQL data types
      const result = await pool
        .request()
        .input("fromDate", sql.VarChar(10), fromDate)
        .input("toDate", sql.VarChar(10), toDate)
        .input("branchId", sql.Int, branchId)
        .execute("tb_api");

      // Check if the result contains the expected JSON key
      const jsonKey = "JSON_F52E2B61-18A1-11d1-B105-00805F49916B";
      if (!result.recordset[0] || !result.recordset[0][jsonKey]) {
        throw new Error("Unexpected response format from stored procedure");
      }

      // Extract and parse the JSON string into a JavaScript object
      const jsonString = result.recordset[0][jsonKey];
      const parsedData = JSON.parse(jsonString);

      res.status(200).json(parsedData);
    } catch (error) {
      console.error("Failed to execute stored procedure:", error.message);
      res.status(500).send("Failed to fetch data from MS SQL");
    } finally {
      await closeConnection();
    }
  },

  fetchBalanceSheetData: async (req, res) => {
    const { companyId, fromDate, toDate, branchId, finYearId, pb, sd } =
      req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const pool = await connectToSql();
      const result = await pool
        .request()
        .input("companyId", sql.Int, companyId)
        .input("companyBranchId", sql.Int, branchId)
        .input("finYearId", sql.Int, finYearId)
        .input("pb", sql.Char(1), pb)
        .input("sd", sql.Char(1), sd)
        .input("fromDate", sql.Date, fromDate)
        .input("toDate", sql.Date, toDate)
        .execute("balanceSheetPnlReport");

      // Check if the result contains the expected JSON key
      const jsonKey = "JSON_F52E2B61-18A1-11d1-B105-00805F49916B";
      if (!result.recordsets[0][0] || !result.recordsets[0][0][jsonKey]) {
        throw new Error("Unexpected response format from stored procedure");
      }

      if (!result.recordsets[1][0] || !result.recordsets[1][0][jsonKey]) {
        throw new Error("Unexpected response format from stored procedure");
      }

      // Ensure both JSON keys exist
      const jsonString1 = result.recordsets[0][0]?.[jsonKey];
      const jsonString2 = result.recordsets[1][0]?.[jsonKey];
      if (!jsonString1 || !jsonString2) {
        throw new Error("Missing expected JSON data from stored procedure");
      }

      // Parse JSON strings
      const parsedData1 = JSON.parse(jsonString1);
      const parsedData2 = JSON.parse(jsonString2);

      // Construct data object
      const data = {
        array1: parsedData1,
        array2: parsedData2,
      };

      res.send({
        success: true,
        message: "Data fetched successfully",
        data: data,
      });
    } catch (error) {
      console.error("Failed to execute stored procedure:", error.message);
      res.status(500).send("Failed to fetch data from MS SQL");
    } finally {
      await closeConnection();
    }
  },
  fetchDataByStoredProcedureAPI: async (req, res) => {
    let pool = null;
    try {
      pool = await connectToSql();
      // Hardcoded stored procedure execution
      const result = await pool.request().query(`
       EXEC yourfaithFully 
    @tableName = 'tbl_voucher',
    @projection = '[{"key":"Narration"}, {"key":"party_name"}]';
      `);
      const recordset = result.recordset;
      if (recordset.length === 0) {
        return res.status(404).json({ error: "No data found" });
      }
      res.status(200).json({
        message: "Data fetched Successfully!",
        //length: recordset.length,
        data: recordset,
      });
    } catch (error) {
      console.error("Failed to execute stored procedure:", error.message);
      res.status(500).json({
        error: "Failed to fetch data from MS SQL",
        message: error.message,
      });
    } finally {
      if (pool) {
        await closeConnection(); // Close the connection
      }
    }
  },
};
