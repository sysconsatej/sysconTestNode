const validate = require("../helper/validate");
const model = require("../models/module");
const {
  executeQuery,
  executeStoredProcedure,
  executeStoredProcedureSecond,
} = require("../modelSQL/model");
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
        voucherTypeId,
        isTaxApplicable,
        rcm,
        formControlId
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
        voucherTypeId: voucherTypeId,
        isTaxApplicable: isTaxApplicable,
        rcm: rcm,
        formControlId:formControlId
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
        clientId,
      } = req.body;
      let parameters = {
        glId: glId,
        partyId: partyId,
        totalAmount: totalAmount,
        invoiceDate: invoiceDate,
        exchangeRateGrid: exchangeRateGrid,
        companyId: companyId,
        clientId: clientId,
        formControlId:formControlId
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
        currencyId,
        exchangeRate,
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
        currencyId,
        exchangeRate,
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

  // saveContainerMovement: async (req, res) => {
  //   try {
  //     const { tblContainerMovement, clientId, userId } = req.body;

  //     if (!Array.isArray(tblContainerMovement) || tblContainerMovement.length === 0) {
  //       return res.status(400).send({
  //         success: false,
  //         message: "No container movement data provided.",
  //         data: [],
  //       });
  //     }

  //     const pad2 = (n) => String(n).padStart(2, "0");
  //     const pad3 = (n) => String(n).padStart(3, "0");

  //     const toSqlDate = (value) => {
  //       const d = value ? new Date(value) : new Date();
  //       if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString("en-CA");
  //       return d.toLocaleDateString("en-CA");
  //     };

  //     const toSqlDateTimeMs = (value) => {
  //       const d = value ? new Date(value) : new Date();
  //       const dt = Number.isNaN(d.getTime()) ? new Date() : d;

  //       const yyyy = dt.getFullYear();
  //       const MM = pad2(dt.getMonth() + 1);
  //       const dd = pad2(dt.getDate());
  //       const HH = pad2(dt.getHours());
  //       const mm = pad2(dt.getMinutes());
  //       const ss = pad2(dt.getSeconds());
  //       const SSS = pad3(dt.getMilliseconds());

  //       return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`;
  //     };

  //     const createdDateWithTime = toSqlDateTimeMs(new Date());

  //     const payload = {
  //       childJson1: tblContainerMovement.map((item) => ({
  //         "tblContainerMovement.containerId": item.containerNo ? Number(item.containerNo) : null,
  //         "tblContainerMovement.agentId": item.agentId ? Number(item.agentId) : null,
  //         "tblContainerMovement.agentBranchId": item.agentBranchId ? Number(item.agentBranchId) : null,
  //         "tblContainerMovement.fromLocationId": item.fromLocationId ? Number(item.fromLocationId) : null,
  //         "tblContainerMovement.toLocationId": item.toLocationId ? Number(item.toLocationId) : null,
  //         "tblContainerMovement.remarks": item.remarks || "",
  //         "tblContainerMovement.activityId": item.activityId ? Number(item.activityId) : null,

  //         "tblContainerMovement.activityDate": toSqlDate(item.activityDate),

  //         "tblContainerMovement.clientId": clientId,
  //         "tblContainerMovement.createdBy": userId,
  //         "tblContainerMovement.jobId": item.jobId ? Number(item.jobId) : null,
  //         "tblContainerMovement.vesselId": item.vesselId ? Number(item.vesselId) : null,
  //         "tblContainerMovement.voyageId": item.voyageId ? Number(item.voyageId) : null,
  //         "tblContainerMovement.importBlId": item.importBlId ? Number(item.importBlId) : null,

  //         "tblContainerMovement.exportBlId": item.exportBlId ? Number(item.exportBlId) : null,

  //         "tblContainerMovement.status": 1,

  //         "tblContainerMovement.createdDate": createdDateWithTime,
  //       })),
  //     };

  //     console.log("Payload to SP:", JSON.stringify(payload, null, 2));

  //     const data = await executeStoredProcedure("staticInsertUpdate", {
  //       jsonPayload: JSON.stringify(payload),
  //     });

  //     // Response
  //     return res.send({
  //       success: true,
  //       message: "Data saved successfully!",
  //       Chargers: data,
  //       count: data?.length || 0,
  //     });
  //   } catch (error) {
  //     console.error("Error in saveContainerMovement:", error);
  //     return res.status(500).send({
  //       success: false,
  //       message: "Error - " + error.message,
  //       data: [],
  //       error: error.message,
  //     });
  //   }
  // },

  saveContainerMovement: async (req, res) => {
    try {
      const {
        tblContainerMovement,
        clientId,
        userId,
        saveMode = "INSERT",
      } = req.body || {};

      // --------------------------------------------------
      // Error helper
      // --------------------------------------------------

      const validationError = (message) => {
        const error = new Error(message);
        error.status = 400;
        throw error;
      };

      // --------------------------------------------------
      // Validate records
      // --------------------------------------------------

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

      // --------------------------------------------------
      // Validate client and user
      // --------------------------------------------------

      const validClientId = Number(clientId);
      const validUserId = Number(userId);

      if (
        !Number.isSafeInteger(validClientId) ||
        validClientId <= 0 ||
        !Number.isSafeInteger(validUserId) ||
        validUserId <= 0
      ) {
        return res.status(400).send({
          success: false,
          message: "Valid clientId and userId are required.",
          data: [],
        });
      }

      // --------------------------------------------------
      // Validate save mode
      // --------------------------------------------------

      if (!["INSERT", "UPDATE"].includes(saveMode)) {
        return res.status(400).send({
          success: false,
          message: "Invalid save mode.",
          data: [],
        });
      }

      const isUpdate = saveMode === "UPDATE";

      // Only one existing movement can be updated at once.

      if (
        isUpdate &&
        tblContainerMovement.length !== 1
      ) {
        return res.status(400).send({
          success: false,
          message: "UPDATE requires exactly one movement record.",
          data: [],
        });
      }

      // --------------------------------------------------
      // Convert nullable numeric IDs
      // --------------------------------------------------

      const toNullableNumber = (
        value,
        fieldName,
        required = false
      ) => {
        if (
          value === null ||
          value === undefined ||
          value === "" ||
          value === "null" ||
          value === 0 ||
          value === "0"
        ) {
          if (required) {
            validationError(`${fieldName} is required.`);
          }

          return null;
        }

        const number = Number(value);

        if (
          !Number.isSafeInteger(number) ||
          number <= 0
        ) {
          validationError(
            `Invalid ${fieldName}: ${String(value)}`
          );
        }

        return number;
      };

      // --------------------------------------------------
      // Date helpers
      // Preserve the supplied local date/time.
      // Do not convert it through the server timezone.
      // --------------------------------------------------

      const pad2 = (n) => String(n).padStart(2, "0");

      const toSqlDateTimeMs = (value, fieldName) => {
        if (
          value === null ||
          value === undefined ||
          value === "" ||
          value === "null"
        ) {
          validationError(`${fieldName} is required.`);
        }

        const input = String(value).trim();

        // Accepted:
        // 2026-09-21T00:00:00
        // 2026-09-21 00:00:00
        // 2026-09-21 00:00:00.000

        const match = input.match(
          /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
        );

        if (!match) {
          validationError(
            `Invalid ${fieldName}. Expected YYYY-MM-DD HH:mm:ss.`
          );
        }

        const [
          ,
          year,
          month,
          day,
          hour,
          minute,
          second = "00",
          milliseconds = "000",
        ] = match;

        const yyyy = Number(year);
        const MM = Number(month);
        const dd = Number(day);
        const HH = Number(hour);
        const mm = Number(minute);
        const ss = Number(second);

        const SSS = milliseconds.padEnd(3, "0");

        // Validate actual calendar date and time.

        const parsedDate = new Date(
          Date.UTC(
            yyyy,
            MM - 1,
            dd,
            HH,
            mm,
            ss,
            Number(SSS)
          )
        );

        if (
          yyyy < 1753 ||
          yyyy > 9999 ||
          parsedDate.getUTCFullYear() !== yyyy ||
          parsedDate.getUTCMonth() + 1 !== MM ||
          parsedDate.getUTCDate() !== dd ||
          parsedDate.getUTCHours() !== HH ||
          parsedDate.getUTCMinutes() !== mm ||
          parsedDate.getUTCSeconds() !== ss
        ) {
          validationError(`Invalid ${fieldName}.`);
        }

        return (
          `${year}-${month}-${day} ` +
          `${pad2(HH)}:${pad2(mm)}:${pad2(ss)}.${SSS}`
        );
      };


      const payload = {
        clientId: validClientId,
        userId: validUserId,
        saveMode,

        childJson1: tblContainerMovement.map((item) => {

          if (!item || typeof item !== "object" || Array.isArray(item)) {
            validationError("Invalid container movement record.");
          }

          // Movement ID is different from container ID.

          const recordId = toNullableNumber(
            item.id,
            "Movement ID",
            isUpdate
          );

          const containerId = toNullableNumber(
            item.containerNo ?? item.containerId,
            "Container ID",
            true
          );

          // Prevent INSERT from accidentally updating/duplicating
          // a record that already has an identity ID.

          if (!isUpdate && recordId !== null) {
            validationError(
              "INSERT cannot contain an existing movement ID."
            );
          }

          // --------------------------------------------------
          // Create database record
          // --------------------------------------------------

          const record = {

            "tblContainerMovement.containerId":
              containerId,

            "tblContainerMovement.agentId":
              toNullableNumber(
                item.agentId,
                "Agent ID",
                true
              ),

            "tblContainerMovement.agentBranchId":
              toNullableNumber(
                item.agentBranchId,
                "Agent Branch ID",
                true
              ),

            "tblContainerMovement.fromLocationId":
              toNullableNumber(
                item.fromLocationId,
                "From Location ID"
              ),

            "tblContainerMovement.toLocationId":
              toNullableNumber(
                item.toLocationId,
                "To Location ID"
              ),

            "tblContainerMovement.remarks":
              String(item.remarks ?? ""),

            "tblContainerMovement.activityId":
              toNullableNumber(
                item.activityId,
                "Activity ID",
                true
              ),

            "tblContainerMovement.activityDate":
              toSqlDateTimeMs(
                item.activityDate,
                "Activity Date"
              ),

            "tblContainerMovement.clientId":
              validClientId,

            "tblContainerMovement.jobId":
              toNullableNumber(
                item.jobId,
                "Job ID"
              ),

            "tblContainerMovement.vesselId":
              toNullableNumber(
                item.vesselId,
                "Vessel ID"
              ),

            "tblContainerMovement.voyageId":
              toNullableNumber(
                item.voyageId,
                "Voyage ID"
              ),

            "tblContainerMovement.importBlId":
              toNullableNumber(
                item.importBlId,
                "Import BL ID"
              ),

            "tblContainerMovement.exportBlId":
              toNullableNumber(
                item.exportBlId,
                "Export BL ID"
              ),

            "tblContainerMovement.status": 1,
          };

          // --------------------------------------------------
          // UPDATE
          // --------------------------------------------------

          if (isUpdate) {

            // Use tblContainerMovement.id.
            // Never substitute containerId here.

            record["tblContainerMovement.id"] =
              recordId;

          }

          // --------------------------------------------------
          // INSERT
          // --------------------------------------------------

          else {

            // Do not send the identity ID.
            // SQL Server generates the new ID.

            record["tblContainerMovement.createdBy"] =
              validUserId;

            // createdDate is generated by SQL Server.

          }

          return record;
        }),
      };

      const jsonPayload = JSON.stringify(payload);

      console.log("Save Mode:", saveMode);

      console.log(
        "Payload to SP:",
        JSON.stringify(payload, null, 2)
      );

      const data = await executeStoredProcedure(
        "saveContainerMovement",
        {
          jsonPayload,
        }
      );
      const savedRecords = Array.isArray(data)
        ? data
        : Array.isArray(data?.recordset)
          ? data.recordset
          : Array.isArray(data?.data)
            ? data.data
            : [];

      const expectedCount = isUpdate
        ? 1
        : tblContainerMovement.length;

      if (savedRecords.length !== expectedCount) {
        throw new Error(
          "Save procedure did not return the expected number of records."
        );
      }

      // --------------------------------------------------
      // Success response
      // --------------------------------------------------

      return res.send({
        success: true,

        message: isUpdate
          ? "Container movement updated successfully!"
          : "Container movement inserted successfully!",

        Chargers: savedRecords,

        count: savedRecords.length,
      });

    } catch (error) {

      console.error(
        "Error in saveContainerMovement:",
        error
      );

      return res.status(error.status || 500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });

    }
  },


  generalLegerBillingParty: async (req, res) => {
    try {
      let { id, clientId, voucherTypeId, companyId } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("GetLedgerNameByHblNo", {
        id,
        clientId,
        voucherTypeId,
        companyId,
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
        },
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
        jobId: jobId || 0,
        chargeId: chargeId || 0,
        companyId: companyId || 0,
        companyBranchId: companyBranchId || 0,
        businessSegmentId: businessSegmentId || 0,
        voucherTypeId: voucherTypeId || 0,
        blId: blId || 0,
        vesselId: vesselId || 0,
        voyageId: voyageId || 0,
        plrId: plrId || 0,
        polId: polId || 0,
        podId: podId || 0,
        fpdId: fpdId || 0,
        berthId: berthId || 0,
        containerId: containerId || 0,
        fromDate,
        toDate,
        billingPartyId: billingPartyId || 0,
        containerStatusId: containerStatusId || 0,
        cargoTypeId: cargoTypeId || 0,
        sizeId: sizeId || 0,
        typeId: typeId || 0,
        agentId: agentId || 0,
        agentBranchId: agentBranchId || 0,
        expImp,
        icd,
        invoiceExchageRate,
        invoiceChargeExchangeRate,
        rate,
        transhipPortId: transhipPortId || 0,
        cfsId: cfsId || 0,
        containerRepairId: containerRepairId || 0,
        depotId: depotId || 0,
        containerTransactionId: containerTransactionId || 0,
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
        },
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
      const { clientId, glId, companyId, companyBranchId } = req.body || {};

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
        companyId: companyId,
        companyBranchId: companyBranchId
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
        .input("recordId", sql.Int, pRecordId === 0 ? null : pRecordId)
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

  getSecondThirdLevelData: async (req, res) => {
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
        invoiceExchangeRate,
        invoiceChargeExchangeRate,
        rate,
        transhipPortId,
        cfsId,
        containerRepairId,
        depotId,
        containerTransactionId,
        includeMNR,
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
        invoiceExchangeRate,
        invoiceChargeExchangeRate,
        rate,
        transhipPortId,
        cfsId,
        containerRepairId,
        depotId,
        containerTransactionId,
        includeMNR,
      };

      // ✅ Replace undefined/empty string with null
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === "") params[key] = null;
      });

      // Call stored procedure
      let data = await executeStoredProcedureSecond(
        "getSecondThirdLevelDetails",
        params,
      );

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

  insertVoucherDataDynamic: async (req, res) => {
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
        .input("recordId", sql.Int, pRecordId === 0 ? null : pRecordId)
        .input("clientId", sql.Int, pClientId)
        .input("companyId", sql.Int, pCompanyId)
        .input("companyBranchId", sql.Int, pCompanyBranchId)
        .input("financialYearId", sql.Int, pFinancialYearId)
        .input("userId", sql.Int, pUserId)
        .input("json", sql.NVarChar(sql.MAX), jsonParam)
        .execute("insertVoucherDataDynamic");

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

  getTariffChargeDetails: async (req, res) => {
    try {
      let {
        clientId,
        chargeId,
        voucherType,
        companyId,
        companyBranchId,
        blIds,
      } = req.body;

      // Call stored procedure with all necessary parameters
      let data = await executeStoredProcedure("getTariffChargeDetails", {
        clientId,
        chargeId,
        voucherType,
        companyId,
        companyBranchId,
        blIds,
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

  getRoundOffSetting: async (req, res) => {
    try {
      let { voucherTypeId, clientId } = req.body;

      let data = await executeStoredProcedure("getRoundOffSettings", {
        voucherTypeId,
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
  checkDischargeDoneForBL: async (req, res) => {
    try {
      let { blno } = req.body;

      let data = await executeStoredProcedure("checkDischargeDoneForBL", {
        blno,
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
  checkJobCreatedAginstBl: async (req, res) => {
    try {
      let { blId, clientId } = req.body;

      let data = await executeStoredProcedure("checkJobCreatedAginstBl", {
        blId,
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
  getBillingPartyForBl: async (req, res) => {
    try {
      let { blId, clientId, voucherTypeId } = req.body;

      let data = await executeStoredProcedure("getBillingPartyOnBl", {
        blId,
        clientId,
        voucherTypeId,
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
  getChargeForTariff: async (req, res) => {
    try {
      let {
        //labourRate,
        // agentId,
        repairLocationId,
        repairTypeId,
        componentId,
        dimension,
        depotId,
        // damageId,
        clientId,
      } = req.body;

      let data = await executeStoredProcedure("getChargesFromTariff", {
        //labourRate,
        //agentId,
        repairLocationId,
        repairTypeId,
        componentId,
        dimension,
        depotId,
        //damageId,
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
  getSecondThirdMasterData: async (req, res) => {
    try {
      const {
        clientId,
        masterJobId,
        companyId,
        companyBranchId,
        businessSegmentId,
        voucherTypeId,
        billingPartyId,
        currencyId,
        invoiceExchangeRate,
        blId
      } = req.body;

      console.log("getSecondThirdMasterData req.body:", req.body);

      const params = {
        clientId,
        masterJobId,
        companyId,
        companyBranchId,
        businessSegmentId,
        voucherTypeId,
        billingPartyId,
        currencyId,
        invoiceExchangeRate,
        blId
      };

      console.log("SP Params:", params);

      const data = await executeStoredProcedureSecond(
        "getSecondThirdLevelDetailsMasterJob",
        params,
      );

      console.log("SP Result:", data);

      if (!data || data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
          Chargers: [],
          count: 0,
        });
      }

      return res.send({
        success: true,
        message: "Data fetched successfully!",
        data: data,        // <-- ADD THIS
        Chargers: data,
        count: data.length,
      });
    } catch (error) {
      console.error("getSecondThirdMasterData ERROR:", error);

      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        Chargers: [],
        error: error.message,
      });
    }
  },
};


