const validate = require("../helper/validate");
const model = require("../models/module");
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const functionForCommaSeperated = require("../helper/CommaSeperatedValue");
const mongoose = require("mongoose");
const moment = require("moment");
const { connectToSql } = require("../config/sqlConfig");
const sql = require("mssql");
// const { errorLogger } = require("../helper/loggerService");
const { log } = require("winston");
function createObjectId(companyId) {
  try {
    if (companyId !== null) {
      return new mongoose.Types.ObjectId(companyId);
    } else {
      return null;
    }
    // Attempt to create a new ObjectId with the provided companyId
  } catch (error) {
    // If an error occurs (e.g., due to an invalid companyId format), return null
    return companyId;
  }
}
function Isnull(value, defaultValue) {
  return value === null || value === undefined || value === ""
    ? defaultValue
    : value;
}
function isDateBetweenGivenDates(givenDate, json) {
  const date = new Date(givenDate);

  // Iterate through tblTaxDetails array to find the effective and validity dates
  for (const taxDetail of json.taxData.tblTaxDetails) {
    const startDate = new Date(taxDetail.effectiveDate);
    const endDate = new Date(taxDetail.validityDate);

    // Check if the given date is between the start and end dates
    if (date >= startDate && date <= endDate) {
      return json;
    }
  }

  return false;
}

module.exports = {
  getJobChargeDetails: async (req, res) => {
    try {
      let {
        clientId,
        voucherType,
        DepartmentId,
        jobIds,
        billingPartyId,
        companyId,
        companyBranchId,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getJobChargeDetails", {
        clientId,
        voucherType,
        DepartmentId,
        jobIds,
        billingPartyId,
        companyId,
        companyBranchId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  gettaxDetails: async (req, res) => {
    try {
      const {
        chargeId,
        SelectedParentInvId,
        invoiceDate,
        glId,
        taxType,
        sacCodeId,
        totalAmount,
        totalAmountFc,
        departmentId,
        placeOfSupply_state,
        sez,
        customerId,
        ownStateId,
        companyId,
        branchId,
        finYearId,
        userId,
        clientId,
        totalAmtInvoiceCurr,
        billingPartyBranch,
        billingPartyState,
        totalAmountHc,
      } = req.body;
      let parameters = {
        chargeId: chargeId,
        totalAmountHc: totalAmountHc,
        totalAmountFc: totalAmountFc,
        invoiceDate: invoiceDate,
        totalAmtInvoiceCurr: totalAmtInvoiceCurr,
        customerId: customerId,
        glId: glId,
        companyId: companyId,
        branchId: branchId,
        finYearId: finYearId,
        userId: userId,
        clientId: clientId,
        billingPartyBranch: billingPartyBranch,
        billingPartyState: billingPartyState,
        taxType: taxType,
        sacCodeId: sacCodeId,
        ownStateId: ownStateId,
        sez: sez,
        SelectedParentInvId: SelectedParentInvId,
        departmentId: departmentId,
        placeOfSupply_state: placeOfSupply_state,
      };
      console.log("parameters", parameters);
      let data = await executeStoredProcedure("getTaxDetails", parameters);
      if (data[0].tblTax === 0) {
        return res.send({
          success: true,
          message: "No data found",
          tblTax: [],
        });
      }
      console.debug("data", data);
      return res.send({
        success: true,
        message: "Data fetched successfully!",
        tblTax: data[0].tblTax,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  getTDSDetails: async (req, res) => {
    try {
      const {
        partyId,
        glId,
        formControlId,
        totalAmount,
        exchangeRateGrid,
        invoiceDate,
        companyId,
      } = req.body;
      let parameters = {
        glId: glId,
        partyId: partyId,
        totalAmount: totalAmount,
        invoiceDate: invoiceDate,
        exchangeRateGrid: exchangeRateGrid,
        companyId: companyId,
        clientId: req.clientId,
      };
      let data = await executeStoredProcedure("GetTdsDetails", parameters);
      if (data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          tblTDS: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        data: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getGeneralLedgerData: async (req, res) => {
    try {
      let { billingPartyId } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("GeneralLedgerData", {
        billingPartyId,
      });
      console.log("data", billingPartyId);
      console.log("data", data);

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getVoucherData: async (req, res) => {
    try {
      let {
        clientId,
        billingPartyId,
        companyId,
        // companyBranchId
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getInvoiceForVoucher", {
        clientId,
        billingPartyId,
        companyId,
        // branchId:companyBranchId
      });
      console.log("data", billingPartyId);
      console.log("data", data);

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getBlChargeDetails: async (req, res) => {
    try {
      let {
        clientId,
        voucherType,
        DepartmentId,
        jobIds,
        blIds,
        billingPartyId,
        companyId,
        companyBranchId,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getBlChargeDetails", {
        clientId,
        voucherType,
        DepartmentId,
        blId: blIds,
        billingPartyId,
        companyId,
        companyBranchId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getTaxDetailsQuotation: async (req, res) => {
    try {
      let {
        DepartmentId,
        chargeId,
        quotationDate,
        companyId,
        sellAmount,
        clientId,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("calculateQuotationTaxAmount", {
        DepartmentId,
        chargeId,
        quotationDate,
        companyId,
        sellAmount,
        clientId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getcontainerActivity: async (req, res) => {
    try {
      let {
        containerNo,
        bookingNo,
        blNo,
        clientId,
        companyId,
        companyBranchId,
        userId,
        financialyearId,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("containerActivity", {
        containerNo,
        bookingNo,
        blNo,
        clientId,
        companyId,
        companyBranchId,
        userId,
        financialyearId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  //  saveContainerMovement: async (req, res) => {
  //   try {
  //     let {
  //     containerNo,
  //     bookingNo,
  //     blNo
  //     } = req.body;

  //     // Call stored procedure with all necessary parameters
  //     let data = await executeStoredProcedure("staticInsertUpdate", {
  //     containerNo,
  //     bookingNo,
  //     blNo
  //     });

  //     if (data?.length === 0) {
  //       return res.send({
  //         success: true,
  //         message: "No data found",
  //         data: [],
  //       });
  //     }

  //     return res.send({
  //       success: true,
  //       message: "Data fetched successfully!",
  //       Chargers: data,
  //       count: data?.length,
  //     });
  //   } catch (error) {
  //     res.status(500).send({
  //       success: false,
  //       message: "Error - " + error.message,
  //       data: [],
  //       error: error.message,
  //     });
  //   }
  // }

  // saveContainerMovement: async (req, res) => {
  //   try {
  //     const { tblContainerMovement, clientId,userId} = req.body;

  //     const payload = {
  //       childJson1: tblContainerMovement?.map((item) => ({
  //         "tblContainerMovement.containerId": item.containerNo ? Number(item.containerNo) : null,
  //         "tblContainerMovement.agentId": item.agentId ? Number(item.agentId) : null,
  //         "tblContainerMovement.agentBranchId": item.agentBranchId ? Number(item.agentBranchId) : null,
  //         //"tblContainerMovement.fromLocationId": item.fromLocationId ? Number(item.fromLocationId) : null,
  //         "tblContainerMovement.toLocationId": item.toLocationId ? Number(item.toLocationId) : null,
  //         "tblContainerMovement.remarks": item.remarks || "",
  //         "tblContainerMovement.activityId": item.activityId ? Number(item.activityId) : null,
  //         "tblContainerMovement.activityDate": item.activityDate || new Date().toISOString(),
  //         "tblContainerMovement.clientId": clientId,
  //         "tblContainerMovement.createdBy": userId,
  //         "tblContainerMovement.createdDate": new Date().toISOString()
  //       })) || [],
  //       // clientId:clientId
  //     };

  //     console.log(payload.childJson1);

  //     const data = await executeStoredProcedure("staticInsertUpdate", {
  //       jsonPayload: JSON.stringify(payload)
  //     });

  //     return res.send({
  //       success: true,
  //       message: "Data saved successfully!",
  //       Chargers: data,
  //       count: data?.length || 0
  //     });
  //   } catch (error) {
  //     return res.status(500).send({
  //       success: false,
  //       message: "Error - " + error.message,
  //       data: [],
  //       error: error.message
  //     });
  //   }
  // }

  saveContainerMovement: async (req, res) => {
    try {
      const { tblContainerMovement, clientId, userId } = req.body;

      // Validation: Ensure we have an array with data
      if (
        !Array.isArray(tblContainerMovement) ||
        tblContainerMovement.length === 0
      ) {
        return res.status(400).send({
          success: false,
          message: "No container movement data provided.",
          data: [],
        });
      }

      // Build payload for SP
      const payload = {
        childJson1: tblContainerMovement.map((item) => ({
          "tblContainerMovement.containerId": item.containerNo
            ? Number(item.containerNo)
            : null,
          "tblContainerMovement.agentId": item.agentId
            ? Number(item.agentId)
            : null,
          "tblContainerMovement.agentBranchId": item.agentBranchId
            ? Number(item.agentBranchId)
            : null,
          "tblContainerMovement.fromLocationId": item.fromLocationId
            ? Number(item.fromLocationId)
            : null,
          "tblContainerMovement.toLocationId": item.toLocationId
            ? Number(item.toLocationId)
            : null,
          "tblContainerMovement.remarks": item.remarks || "",
          "tblContainerMovement.activityId": item.activityId
            ? Number(item.activityId)
            : null,
          "tblContainerMovement.activityDate": item.activityDate
            ? new Date(item.activityDate).toLocaleDateString("en-CA")
            : new Date().toLocaleDateString("en-CA"),
          "tblContainerMovement.clientId": clientId,
          "tblContainerMovement.createdBy": userId,
          "tblContainerMovement.jobId": item.jobId ? Number(item.jobId) : null,
          "tblContainerMovement.vesselId": item.vesselId
            ? Number(item.vesselId)
            : null,
          "tblContainerMovement.voyageId": item.voyageId
            ? Number(item.voyageId)
            : null,
          "tblContainerMovement.importBlId": item.importBlId
            ? Number(item.importBlId)
            : null,
          "tblContainerMovement.importBlId": item.exportBlId
            ? Number(item.exportBlId)
            : null,
          "tblContainerMovement.status": 1,
          "tblContainerMovement.createdDate": new Date().toLocaleDateString(
            "en-CA"
          ),
        })),
      };

      // Debug log - verify before sending to SP
      console.log("Payload to SP:", JSON.stringify(payload, null, 2));

      // Execute stored procedure
      const data = await executeStoredProcedure("staticInsertUpdate", {
        jsonPayload: JSON.stringify(payload),
      });

      // Response
      return res.send({
        success: true,
        message: "Data saved successfully!",
        Chargers: data,
        count: data?.length || 0,
      });
    } catch (error) {
      console.error("Error in saveContainerMovement:", error);
      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  generalLegerBillingParty: async (req, res) => {
    try {
      let { id } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("GetLedgerNameByHblNo", {
        id,
      });
      console.log("data", data);

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  getContainerChargeDetails: async (req, res) => {
    try {
      let {
        clientId,
        voucherType,
        DepartmentId,
        containerRepairIds,
        billingPartyId,
        companyId,
        companyBranchId,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure(
        "getContainerRepairChargeDetails",
        {
          clientId,
          voucherType,
          DepartmentId,
          containerRepairIds,
          billingPartyId,
          companyId,
          companyBranchId,
        }
      );

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  getThirdLevelDetails: async (req, res) => {
    try {
      let {
        clientId,
        jobId,
        chargeId,
        companyId,
        companyBranchId,
        businessSegmentId,
        voucherTypeId,
        blId,
        vesselId,
        voyageId,
        plrId,
        polId,
        podId,
        fpdId,
        berthId,
        containerId,
        fromDate,
        toDate,
        billingPartyId,
        containerStatusId,
        cargoTypeId,
        sizeId,
        typeId,
        // optional future params if needed:
        agentId,
        agentBranchId,
        expImp,
        icd,
        invoiceExchageRate,
        invoiceChargeExchangeRate,
        rate,
        transhipPortId,
        cfsId,
        containerRepairId,
        depotId,
        containerTransactionId,
      } = req.body;

      // ✅ Build params object for stored procedure
      let params = {
        clientId,
        jobId,
        chargeId,
        companyId,
        companyBranchId,
        businessSegmentId,
        voucherTypeId,
        blId,
        vesselId,
        voyageId,
        plrId,
        polId,
        podId,
        fpdId,
        berthId,
        containerId,
        fromDate,
        toDate,
        billingPartyId,
        containerStatusId,
        cargoTypeId,
        sizeId,
        typeId,
        agentId,
        agentBranchId,
        expImp,
        icd,
        invoiceExchageRate,
        invoiceChargeExchangeRate,
        rate,
        transhipPortId,
        cfsId,
        containerRepairId,
        depotId,
        containerTransactionId,
      };

      // ✅ Replace undefined/empty string with null
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === "") params[key] = null;
      });

      // Call stored procedure
      let data = await executeStoredProcedure("getThirdLevelDetails", params);

      if (!data || data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getDetentionDetails: async (req, res) => {
    try {
      let {
        blId,
        chargeId,
        clientId,
        companyId,
        companyBranchId,
        businessSegmentId,
      } = req.body;

      let data = await executeStoredProcedure("getdetentiondetails", {
        blId,
        chargeId,
        clientId,
        companyId,
        companyBranchId,
        businessSegmentId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  getThirdLevelPurchaseContainerWise: async (req, res) => {
    try {
      let { billingPartyId, fromDate, toDate, chargeId, clientId } = req.body;

      let data = await executeStoredProcedure(
        "getThirdLevelPurchaseContainerWise",
        {
          billingPartyId,
          fromDate,
          toDate,
          chargeId,
          clientId,
        }
      );

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  calculateDetentionRate: async (req, res) => {
    try {
      let {
        blId,
        noOfDays,
        clientId,
        businessSegmentId,
        fromDate,
        toDate,
        containerId,
      } = req.body;
      let data = await executeStoredProcedure("calculateDetentionRate", {
        blId,
        noOfDays,
        clientId,
        businessSegmentId,
        fromDate,
        toDate,
        containerId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getVoucher: async (req, res) => {
    try {
      // Accept either { clientId, glId } or legacy { id } -> throw if missing
      const { clientId, glId } = req.body || {};

      if (!clientId || !glId) {
        return res.status(400).send({
          success: false,
          message: "clientId and glId are required.",
          data: [],
        });
      }

      const data = await executeStoredProcedure("unadjustedVoucherData", {
        clientId: Number(clientId),
        glId: Number(glId),
      });

      if (!Array.isArray(data) || data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
          count: 0,
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        vouchers: data, // clearer key name
        count: data.length,
      });
    } catch (error) {
      console.error("getVoucher error:", error);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getVoucherThirlLevelData: async (req, res) => {
    try {
      // Accept either { clientId, glId } or legacy { id } -> throw if missing
      const { clientId, glId } = req.body || {};

      if (!clientId || !glId) {
        return res.status(400).send({
          success: false,
          message: "clientId and glId are required.",
          data: [],
        });
      }

      const data = await executeStoredProcedure("unadjustedThirdLevelVoucherData", {
        clientId: Number(clientId),
        glId: Number(glId),
      });

      if (!Array.isArray(data) || data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
          count: 0,
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        vouchers: data, // clearer key name
        count: data.length,
      });
    } catch (error) {
      console.error("getVoucher error:", error);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  getThirdLevelDetailsPurchase: async (req, res) => {
    try {
      let { clientId, jobId, chargeId } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getThirdLevelDetails", {
        clientId,
        jobId,
        chargeId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  fetchContainerDropdownData: async (req, res) => {
    try {
      let { clientId, plrAgentId, plrAgentBranchId, depotId } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getDepotEmptyContainers", {
        clientId,
        plrAgentId,
        plrAgentBranchId,
        depotId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  editContainerMovement: async (req, res) => {
    try {
      let { clientId, containerId } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("GetContainerEditLastMovement", {
        clientId,
        containerId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  insertVoucherData: async (req, res) => {
    try {
      let {
        recordId,
        clientId,
        companyId,
        companyBranchId,
        financialYearId,
        userId,
        json,
      } = req.body;

      // ---- Basic validation (INT params) ----
      const toInt = (v, name) => {
        const n = Number(v);
        if (!Number.isInteger(n)) {
          throw new Error(`Invalid integer for "${name}"`);
        }
        return n;
      };

      const pRecordId = toInt(recordId, "recordId");
      const pClientId = toInt(clientId, "clientId");
      const pCompanyId = toInt(companyId, "companyId");
      const pCompanyBranchId = toInt(companyBranchId, "companyBranchId");
      const pFinancialYearId = toInt(financialYearId, "financialYearId");
      const pUserId = toInt(userId, "userId");
      let jsonParam = json;
      if (typeof jsonParam !== "string") {
        jsonParam = JSON.stringify(jsonParam ?? {});
      }
      // Optional sanity check: make sure it parses
      try {
        JSON.parse(jsonParam);
      } catch {
        throw new Error("The 'json' payload is not valid JSON text");
      }

      const pool = await connectToSql();
      const request = pool.request();

      const result = await request
        .input("recordId", sql.Int, pRecordId)
        .input("clientId", sql.Int, pClientId)
        .input("companyId", sql.Int, pCompanyId)
        .input("companyBranchId", sql.Int, pCompanyBranchId)
        .input("financialYearId", sql.Int, pFinancialYearId)
        .input("userId", sql.Int, pUserId)
        .input("json", sql.NVarChar(sql.MAX), jsonParam)
        .execute("insertVoucherData");

      const rows = result?.recordset ?? [];

      if (!rows.length) {
        return res.send({
          success: true,
          message: "No data returned.",
          data: [],
          rowsAffected: result?.rowsAffected || [],
        });
      }

      return res.send({
        success: true,
        message: "Data Inserted successfully.",
        data: rows,
        rowsAffected: result?.rowsAffected || [],
      });
    } catch (error) {
      return res.status(400).send({
        success: false,
        message: error.message || "Request failed.",
        data: [],
      });
    }
  },

  getContainerNextActivities: async (req, res) => {
    try {
      const {
        containerId,
        companyId,
        companybranchId,
        financialyearId,
        userId,
        clientId,
      } = req.body || {};

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("containerNextActivities", {
        containerId,
        companyId,
        companybranchId,
        financialyearId,
        userId,
        clientId,
      });

      if (data?.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: data,
        count: data?.length,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
};
