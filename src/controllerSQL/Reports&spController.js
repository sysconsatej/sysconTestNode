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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  spInvoice: async (req, res) => {
    try {
      const { invoiceId } = req.body;
      const query = `invoiceData`;
      const parameters = {
        invoiceId,
      };
      console.log("parameters", invoiceId);
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  spVehicleRoute: async (req, res) => {
    try {
      const { id } = req.body;
      const query = `vehicleRouteData`;
      const parameters = {
        id,
      };
      console.log("parameters", invoiceId);
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
  spJob: async (req, res) => {
    try {
      const { id } = req.body;
      const query = `jobData`;
      const parameters = {
        id,
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
  spVocher: async (req, res) => {
    try {
      const { id } = req.body;
      const query = `voucherData`;
      const parameters = {
        id,
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
        message: "Error - " + error.message,
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  reportTheme: async (req, res) => {
    try {
      const { clientId, reportId } = req.body;
      const query = `reportThemeApi`;
      const parameters = {
        clientId,
        reportId,
      };
      const data = await executeStoredProcedure(query, parameters);
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
  spBl: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `blData`;
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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  saveReportData: async (req, res) => {
    try {
      const { data, spName } = req.body;
      let query = spName;
      const parameters = {
        data: JSON.stringify(data),
        clientId: req.clientId,
      };
      let data1 = await executeStoredProcedure(query, parameters);
      if (data1) {
        res.send({
          success: true,
          message: "Data saved successfully",
          count: data1.length,
          data: data1,
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
