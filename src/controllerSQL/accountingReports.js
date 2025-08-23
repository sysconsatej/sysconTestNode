const express = require("express");
const nodemailer = require("nodemailer");
const { connectToSql } = require("../config/sqlConfig");
const sql = require("mssql");

const app = express();
app.use(express.json());

function safeParse(val) {
  if (!val) return []; // null, undefined, empty string
  if (Array.isArray(val)) return val; // already parsed array
  if (typeof val === "object") return [val]; // plain object, wrap in array
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch (e) {
      console.error("JSON parse failed:", val, e.message);
      return [];
    }
  }
  return [];
} //safeParse

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
    const {
      companyId,
      fromDate,
      toDate,
      branchId,
      finYearId,
      pb,
      sd,
      clientId,
    } = req.body;

    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const pool = await connectToSql();
      const result = await pool
        .request()
        .input("companyId", sql.Int, parseInt(companyId, 10))
        .input("companybranchId", sql.Int, parseInt(branchId, 10))
        .input("finYearId", sql.Int, parseInt(finYearId, 10))
        .input("pb", sql.Char(1), pb)
        .input("sd", sql.Char(1), sd)
        .input("fromDate", sql.Date, fromDate)
        .input("toDate", sql.Date, toDate)
        .input("clientId", sql.Int, parseInt(clientId, 10))
        .execute("balanceSheetPnlReport");

      // Check if the result contains the expected JSON key
      let jsonString1 = [];
      let jsonString2 = [];

      const jsonKey = "JSON_F52E2B61-18A1-11d1-B105-00805F49916B";

      if (result.recordsets[0]?.[0]?.[jsonKey]) {
        jsonString1 = result.recordsets[0][0][jsonKey];
      }

      if (result.recordsets[1]?.[0]?.[jsonKey]) {
        jsonString2 = result.recordsets[1][0][jsonKey];
      }

      // Parse JSON safely
      // const parsedData1 = jsonString1 ? JSON.parse(jsonString1) : [];
      // const parsedData2 = jsonString2 ? JSON.parse(jsonString2) : [];

      const parsedData1 = safeParse(jsonString1);
      const parsedData2 = safeParse(jsonString2);

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
      //await closeConnection();
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
