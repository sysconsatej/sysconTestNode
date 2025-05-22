const validate = require("../helper/validate");
const model = require("../models/module");
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const functionForCommaSeperated = require("../helper/CommaSeperatedValue");
const mongoose = require("mongoose");
const moment = require("moment");
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
      } = req.body;
      let parameters = {
        chargeId: chargeId,
        invoiceDate: invoiceDate,
        SelectedParentInvId: SelectedParentInvId,
        glId: glId,
        taxType: taxType,
        sacCodeId: sacCodeId,
        totalAmount: totalAmount,
        totalAmountFc: totalAmountFc,
        departmentId: departmentId,
        placeOfSupply_state: placeOfSupply_state,
        sez: sez,
        customerId: customerId,
        ownStateId: ownStateId,
        companyId: companyId,
        branchId: branchId,
        finYearId: finYearId,
        userId: userId,
        clientId: clientId,
        totalAmtInvoiceCurr: totalAmtInvoiceCurr,
        billingPartyBranch: billingPartyBranch,
        billingPartyState: billingPartyState,
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
  }

};
