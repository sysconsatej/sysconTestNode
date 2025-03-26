const validate = require("../helper/validate");
const model = require("../models/module");
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const functionForCommaSeperated = require("../helper/CommaSeperatedValue");
const mongoose = require("mongoose");
const moment = require("moment");
const { errorLogger } = require("../helper/loggerService");
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
        id,
        //menuID,
        // pageMode,
        // moduleTemplateId,
        clientId,
        voucherType,
        // chargeBasedOn,
        DepartmentId,
        jobIds,
        // blIds,
        //  vesselId,
        //  voyageId,
        billingPartyId,
        // principalId,
        // invoiceType,
        companyId,
        companyBranchId,
        // filterValue,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getJobChargeDetails", {
        //menuId: menuID,
        // pageMode,
        // moduleTemplateId,
        clientId,
        voucherType,
        // chargeBasedOn,
        DepartmentId,
        jobIds,
        // blIds,
        //  vesselId,
        //  voyageId,
        billingPartyId,
        //  principalId,
        // invoiceType,
        companyId,
        companyBranchId,
        //id: filterValue,
      });
      console.log("DATA------", data);

      if (data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      let finalData = [];
      if (Array.isArray(data)) {
        for (const item of data) {
          let value = item.tblJobCharge;
          let temp = {
            jobChargeId: value?._id || null,
            description: value?.chargeDescription || "",
            jobId: item?._id || null,
            jobIddropdown: [{ value: item?._id, label: item?.jobNo }],
            rate: value?.sellRate || 0,
            qty: value?.qty || 0,
            chargeId: value?.chargeId || null,
            chargeIddropdown: [
              { value: value?.chargeId, label: item?.tblChargeDesc?.name },
            ],
            currencyId: value?.sellCurrencyId || null,
            currencyIddropdown: [
              { value: value?.sellCurrencyId, label: item?.sellCur?.name },
            ],
            totalAmount: value?.sellNetAmount || 0,
            totalAmountFc: value?.sellNetAmount || 0,
            exchangeRate: value?.sellExchangeRate || 1,
            tblInvoiceChargeTax: [],
          };
          finalData.push(temp);
        }
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        Chargers: finalData,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Something went wrong",
        data: [],
        error: error.message,
      });
    }
  },
};
