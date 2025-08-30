const {
  executeQuery,
  executeStoredProcedure,
  executeStoredProcedureToSendEmail,
  executeStoredProcedureXML,
} = require("../modelSQL/model");
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
  spBlDataForDO: async (req, res) => {
    try {
      const { id } = req.body;
      const query = `blDataForDO`;
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
  spInvoice: async (req, res) => {
    try {
      const { invoiceId , reportId } = req.body;
      const query = `invoiceData`;
      const parameters = {
        invoiceId,
        reportId,
      };
      console.log("parameters", invoiceId, reportId);
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
  spAirwayBill: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `airwaybilldata`;
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
      const { json, spName, type } = req.body;
      let query = spName;
      const parameters = {
        json: JSON.stringify(json),
      };
      let data1 = null;

      if (type === "Email") {
        data1 = await executeStoredProcedureToSendEmail(query, parameters);
      } else if (type == "xml") {
        data1 = await executeStoredProcedureXML(query, parameters);
      } else if (type === undefined || type === null || type === "") {
        data1 = await executeStoredProcedure(query, parameters, type);
      }

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
  spblconsole: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `blconsole`;
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
  spBl: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `bldata`;
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
  spContainerActivity: async (req, res) => {
    try {
      const { filterCondition } = req.body;
      const query = `containerActivity`;
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
  spIgmReport: async (req, res) => {
    try {
      const { id } = req.body;
      // const query = `igmBlData`;
      const query = `igmBlData`;
      const parameters = {
        filterCondition: id,
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
  spCargoManifestBldata: async (req, res) => {
    try {
      const { id } = req.body;
      // const query = `igmBlData`;
      const query = `cargoManifestBldata`;
      const parameters = {
        filterCondition: id,
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
}; //end
