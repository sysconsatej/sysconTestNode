const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");
const { concat } = require("lodash");

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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  insertUpdateData: async (req, res) => {
    try {
      const { TableName, Record, WhereCondition } = req.body;

      // Convert the Record object to a JSON string
      const formattedRecord = JSON.stringify(Record);

      // Connect to the database
      const pool = await connectToSql();

      // Prepare the stored procedure request
      const request = pool.request();
      request.input("TableName", sql.NVarChar, TableName);
      request.input("Record", sql.NVarChar(sql.MAX), formattedRecord);
      request.input("WhereCondition", sql.NVarChar, WhereCondition);
      request.output("RowsAffected", sql.Int); // Add output parameter

      // Execute the stored procedure
      const result = await request.execute("spDynamicInsertUpdate");

      // Check the RowsAffected output parameter
      const rowsAffected = result.output.RowsAffected;

      // Respond to the client
      if (rowsAffected > 0) {
        res.send({
          success: true,
          message: "Data Inserted/Updated Successfully",
          rowsAffected: rowsAffected,
        });
      } else {
        res.send({
          success: false,
          message: "No rows affected",
          rowsAffected: rowsAffected,
        });
      }
    } catch (error) {
      console.error("Error executing stored procedure:", error);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        error: error.message,
      });
    }
  },
  insertUpdateRecordData: async (req, res) => {
    try {
      const { TableName, Record, WhereCondition } = req.body;

      // Convert the Record object to a JSON string
      const formattedRecord = JSON.stringify(Record);

      // Connect to the database
      const pool = await connectToSql();

      // Prepare the stored procedure request
      const request = pool.request();
      request.input("TableName", sql.NVarChar, TableName);
      request.input("Record", sql.NVarChar(sql.MAX), formattedRecord);
      request.input("WhereCondition", sql.NVarChar, WhereCondition || null);
      request.output("RowsAffected", sql.Int); // Add output parameter

      // Execute the stored procedure
      const result = await request.execute("spDynamicInsertUpdateRecord");

      const rowsAffected = result.output.RowsAffected;
      // Respond to the client
      if (rowsAffected > 0) {
        res.send({
          success: true,
          message: "Data Inserted/Updated Successfully",
          rowsAffected,
        });
      } else {
        res.send({
          success: false,
          message:
            "No rows affected. Record might be identical or condition didn’t match.",
          rowsAffected,
          debug: {
            executedSQL: result?.recordsets,
            inputData: Record,
          },
        });
      }
    } catch (error) {
      console.error("❌ Error executing stored procedure:", error);
      res.status(500).send({
        success: false,
        message: "Server Error - " + error.message,
        error: error.message,
      });
    }
  },
  reportSearchCriteriaApi: async (req, res) => {
    try {
      const { menuId, clientId } = req.body;
      const query = `reportSearchCriteriaApi`;
      const parameters = {
        menuId,
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  reportSearchCriteriaAppApi: async (req, res) => {
    try {
      const { menuId, clientId } = req.body;
      const query = `reportSearchCriteriaMobileApi`;
      const parameters = {
        menuId,
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  getGLChargeDetails: async (req, res) => {
    try {
      const { chargeId, voucherTypeId } = req.body;
      const query = `getGLChargeDetails`;
      const parameters = {
        chargeId,
        voucherTypeId,
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
