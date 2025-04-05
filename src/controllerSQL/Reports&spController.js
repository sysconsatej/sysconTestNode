const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");

module.exports = {
  spRateRequest: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `rateRequestData`;
      const parameters = {
        filterCondition,
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
  spInvoice: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `invoiceData`;
      const parameters = {
        filterCondition,
      };
      console.log("parameters", filterCondition);
      let data = await executeStoredProcedure(query, parameters);
      console.log("data", data);
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
  spJob: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `jobData`;
      const parameters = {
        filterCondition,
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
      const { filterCondition, spName } = req.body;
      const query = spName;
      const parameters = {
        fromDate,
        toDate,
        clientId,
      };
      let data = await executeStoredProcedure(query, filterCondition);
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
  getDynamicReportDetails: async (req, res) => {
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
