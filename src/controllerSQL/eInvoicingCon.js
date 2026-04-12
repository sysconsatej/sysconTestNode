const validate = require("../helper/validate");
const model = require("../modelSQL/model");
const functionForCommaSeperated = require("../helper/CommaSeperatedValue");
const mongoose = require("mongoose");
const moment = require("moment");
// const { errorLogger } = require("../helper/loggerService");

const {
  executeQuery,
  executeStoredProcedure,
  executeNonJSONStoredProcedure,
} = require("../modelSQL/model");
const { response } = require("express");

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

// myModule.js
// Reusable function version
const generateIRNFunction = async (invoiceId) => {
  // Here, fetch the necessary data to generate IRN using invoiceId
  // Adjust SP and params as per your business logic
  const data = await executeStoredProcedure("einvoicingGSTHero", {
    invoiceId,
  });

  console.log("generateIRNFunction data:", data);
  return data;
};

function createHttpError(status, message, options = {}) {
  const error = new Error(message);
  error.status = status;
  error.isOperational = true;
  Object.assign(error, options);
  return error;
}

function requireFields(source, fields) {
  const missingFields = fields.filter((field) => {
    const value = source?.[field];
    return value === undefined || value === null || value === "";
  });

  if (missingFields.length > 0) {
    throw createHttpError(
      400,
      `Missing required parameter: ${missingFields.join(", ")}`,
      { data: [] }
    );
  }
}

function escapeSqlString(value) {
  return String(value ?? "").replace(/'/g, "''");
}

async function parseJsonResponse(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return rawBody;
  }
}

function getGstHeroErrorMessage(responseData, fallbackMessage) {
  if (
    responseData &&
    Array.isArray(responseData.error) &&
    responseData.error.length > 0
  ) {
    const errorMessage = responseData.error
      .map((item) => item?.errorMsg || item?.message || item)
      .filter(Boolean)
      .join(", ");

    if (errorMessage) {
      return errorMessage;
    }
  }

  if (typeof responseData === "string" && responseData.trim()) {
    return responseData;
  }

  return (
    responseData?.error_description ||
    responseData?.message ||
    fallbackMessage
  );
}

function sendError(res, error, options = {}) {
  if (res.headersSent) {
    return;
  }

  const {
    fallbackMessage = "Something went wrong",
    defaultStatus = 500,
    defaultData = [],
  } = options;

  const status = error?.status || defaultStatus;
  const message = error?.isOperational ? error.message : fallbackMessage;
  const payload = {
    success: false,
    message,
    data: error?.data ?? defaultData,
  };

  if (!error?.isOperational || error?.includeErrorField) {
    payload.error = error?.originalMessage || error?.message || message;
  }

  if (error?.details) {
    payload.details = error.details;
  }

  return res.status(status).send(payload);
}

module.exports = {
  isEInvoicing: async (req, res) => {
    try {
      const { invoiceId, billingPartyId, companyId } = req.body;

      requireFields(req.body, [
        "invoiceId",
        "billingPartyId",
        "companyId",
        "loginBranch",
      ]);

      // Step 1: Check if invoice is eligible
      const result = await executeNonJSONStoredProcedure("isEinvoicing", {
        invoiceId,
      });
      const isEinvoicing = result?.recordset[0]?.isenvoicing || "n";

      console.log("E-invoicing result:", result);

      if (isEinvoicing !== "y") {
        return res.send({
          success: true,
          message: "Invoice is not eligible for e-invoicing",
          isEinvoicing,
        });
      }

      // Step 2: Fetch auth credentials
      await module.exports.Pre_AuthenticationResponse(req);

      // Step 3: Authenticate with GSTHero
      const authRespons = await module.exports.getAuthenticationResponse_GSTHero(
        req
      );
      const accessToken = authRespons.access_token;
      const gstin = authRespons.gstin;
      const serverLink = authRespons.serverLink;

      // Step 4: Fetch invoice data
      const invoiceData = await executeStoredProcedure("einvoicingGSTHero", {
        invoiceId
      });

      if (!invoiceData || invoiceData.length === 0) {
        return res.send({
          success: true,
          message: "No invoice data found",
          data: [],
        });
      }
      console.log("Fetched invoice data for IRN generation:", invoiceData);
      // Step 5: Send data to generate IRN
      const irnEndpoint = `${serverLink}/invoice`;
      const irnResponse = await fetch(irnEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Connector-Auth-Token': authRespons.xConnectorResult,
          gstin,
          "Content-Type": "application/json",
          action: "GENERATEIRN",
        },
        body: JSON.stringify(invoiceData),
      });
      const irnResponseData = await parseJsonResponse(irnResponse);
      console.log("IRN generation response from GSTHero:", irnResponseData);

      if (!irnResponse.ok) {
        throw createHttpError(
          irnResponse.status || 502,
          getGstHeroErrorMessage(
            irnResponseData,
            "IRN generation failed at GSTHero"
          ),
          {
            data: [],
          }
        );
      }
      if (irnResponseData.error && irnResponseData.error.length > 0) {
        let errorMessage = getGstHeroErrorMessage(
          irnResponseData,
          "IRN generation failed with errors from GSTHero"
        );
        throw createHttpError(
          400,
          errorMessage,
          {
            data: [],
          }
        );

      }

      const { ackDate, ackNo, irn, signedQrCode, signedInvoice } =
        irnResponseData || {};
      const updateQuery = `UPDATE tblInvoice set ackDate='${escapeSqlString(
        ackDate
      )}', ackNo='${escapeSqlString(ackNo)}', irn='${escapeSqlString(
        irn
      )}', signedQrCode='${escapeSqlString(
        signedQrCode
      )}', signedInvoice='${escapeSqlString(
        signedInvoice
      )}' where id=${invoiceId}`;
      await executeQuery(updateQuery, {});

      // Step 6: Return response
      return res.send({
        success: true,
        message: "IRN generation completed",
        isEinvoicing,
        irnResponse: irnResponseData,
      });
    } catch (error) {
      console.error("Error in isEInvoicing:", error);
      if (res.headersSent) {
        return;
      }

      return sendError(res, error, {
        fallbackMessage: `Error - ${error.message}`,
      });
    }
  },

  // Optional: Keep this route for independent IRN generation
  generateIRN: async (req, res) => {
    try {
      const { invoiceId } = req.body;

      requireFields(req.body, ["invoiceId"]);

      const data = await generateIRNFunction(invoiceId);

      if (!data || data.length === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
        });
      }

      return res.send({
        success: true,
        message: "IRN data fetched successfully!",
        data,
        count: data.length,
      });
    } catch (error) {
      console.error("Error in generateIRN:", error);
      if (res.headersSent) {
        return;
      }

      return sendError(res, error, {
        fallbackMessage: `Error - ${error.message}`,
      });
    }
  },

  Pre_AuthenticationResponse: async (req) => {
    try {
      const accInvId = req.body.invoiceId;
      const { loginBranch } = req.body;

      requireFields(
        { accInvId, loginBranch },
        ["accInvId", "loginBranch"]
      );

      // Step 1: Fetch username, password, client_id, scope, gstin
      const credentialsResult = await executeQuery(
        `
       
select  c.gstHeroUsername as username,c.gstHeroPassword as password ,c.gstHeroClientId as client_id,c.scope as scope,c.gstNo as gstin  from tblinvoice a inner join tblCompanyBranchParameter c on a.companyBranchId= c.companyBranchId where a.id= ${accInvId}
      `,
        {}
      );

      if (!credentialsResult.recordset.length) {
        throw createHttpError(
          404,
          "No credentials found for the given account invoice ID",
          {
            data: [],
          }
        );
      }

      const { username, password, client_id, scope, gstin } =
        credentialsResult.recordset[0];

      if (!username || !password || !client_id || !scope || !gstin) {
        throw createHttpError(
          400,
          "Missing required parameters: username, password, client_id, scope, gstin",
          {
            data: [],
          }
        );
      }

      // Match the legacy .NET flow: pre-auth always targets GSTHero directly.
      const authKeyResult = await executeQuery(
        `SELECT ISNULL(basicAuthKey, '') AS keys,einvoiceServerLink FROM tblCompanyBranchParameter WHERE companyBranchId = ${loginBranch}`,
        {}
      );
      const serverLink = "https://gsthero.com";
      const basicAuthKey = authKeyResult.recordset[0]?.keys;

      if (!basicAuthKey) {
        throw createHttpError(
          404,
          "Basic authorization key not found for the given branch",
          {
            data: [],
          }
        );
      }
      console.log("Fetched credentials and configuration for pre-authentication:", username, password)

      // Step 3: Construct request URL
      const requestUrl = `${serverLink}/auth-server/oauth/token?username=${encodeURIComponent(
        username
      )}&grant_type=password&password=${encodeURIComponent(
        password
      )}&scope=${encodeURIComponent(scope)}&client_id=${encodeURIComponent(
        client_id
      )}`;
      console.log(requestUrl);

      console.log(username, password, client_id, scope, gstin, basicAuthKey);

      // Step 4: Make POST request to GSTHero OAuth token endpoint
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          gstin,
          Authorization: basicAuthKey,
        },
      });
      const responseData = await parseJsonResponse(response);
      console.log("Pre_AuthenticationResponse:", responseData);

      if (!response.ok) {
        throw createHttpError(
          response.status || 502,
          getGstHeroErrorMessage(
            responseData,
            "Pre-authentication response fetch failed"
          ),
          {
            data: [],
          }
        );
      }

      const updateQuery = `update tblCompanyBranchParameter set preAuthToken='${escapeSqlString(
        responseData?.access_token
      )}' where companyBranchId=${loginBranch}`;
      await executeQuery(updateQuery, {});

      return {
        ...responseData,
        success: true,
        message: "Pre-authentication response fetched successfully",
        data: [],
      };
    } catch (error) {
      console.error("Error in Pre_AuthenticationResponse:", error.message);

      if (error.isOperational) {
        throw error;
      }

      throw createHttpError(500, "Something went wrong during pre-authentication", {
        data: [],
        includeErrorField: true,
        originalMessage: error.message,
      });
    }
  },

  getAuthenticationResponse_GSTHero: async (req) => {
    try {
      const accInvId = req.body.invoiceId;
      const { loginBranch, companyId } = req.body;

      requireFields(
        { accInvId, loginBranch, companyId },
        ["accInvId", "loginBranch", "companyId"]
      );

      // Get JSON payload from stored procedure
      const result = await executeQuery(
        `EXEC einvoicingGstheroAuthentication @invoiceId = ${accInvId}, @branchid = ${loginBranch}, @companyId = ${companyId} , @clientId = ${req.clientId}`,
        {}
      );
      console.log("AuthenticationResponse:", result.recordset);

      const jsonOutput = result.recordset
        .map((row) => row[Object.keys(row)[0]])
        .join("");

      if (!jsonOutput) {
        throw createHttpError(404, "No authentication data found.", {
          data: [],
        });
      }

      // Fetch supporting data
      const [serverLinkResult, gstinResult, tokenResult, xConnectorResult] =
        await Promise.all([
          executeQuery(
            `SELECT ISNULL(einvoiceServerLink, '') AS link FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(gstNo, '') AS gstin FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(preAuthToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId=${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(xconnectorAuthToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
        ]);

      const serverLink =
        serverLinkResult.recordset[0]?.link || "https://gsthero.com";
      const gstin = gstinResult.recordset[0]?.gstin;
      const token = tokenResult.recordset[0]?.token;
      const xConnectorToken = xConnectorResult.recordset[0]?.token;

      if (!gstin || !token || !xConnectorToken) {
        throw createHttpError(
          404,
          "Authentication configuration is incomplete for the given branch",
          {
            data: [],
          }
        );
      }

      const requestUrl = `${serverLink}/authentication`;
      const preauthToken = `Bearer ${token}`;
      const action = "ACCESSTOKEN";

      console.log("Making authentication request to GSTHero with URL:", requestUrl);
      console.log("Request headers:", {
        method: "POST",
        headers: {
          "X-Connector-Auth-Token": xConnectorToken,
          Authorization: preauthToken,
          gstin,
          action,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: jsonOutput,
      });
      // Make authentication request
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Connector-Auth-Token": xConnectorToken,
          Authorization: preauthToken,
          gstin,
          action,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: jsonOutput,
      });
      const responseData = await parseJsonResponse(response);
      console.log("AuthenticationResponse:", responseData);

      if (!response.ok) {
        throw createHttpError(
          response.status || 502,
          getGstHeroErrorMessage(
            responseData,
            "Authentication response fetch failed"
          ),
          {
            data: [],
            details: {
              endpoint: requestUrl,
              action,
              statusCode: response.status || 502,
              response: responseData,
            },
          }
        );
      }

      const updateQuery = `update tblCompanyBranchParameter set authToken='${escapeSqlString(
        responseData?.access_token
      )}' where companyBranchId=${loginBranch}`;
      await executeQuery(updateQuery, {});

      return {
        ...responseData,
        gstin,
        serverLink,
        xConnectorResult,
        success: true,
        message: "Authentication response fetched successfully!",
        data: [],
      };
    } catch (error) {
      console.error("Error in getAuthenticationResponse_GSTHero:", error);

      if (error.isOperational) {
        throw error;
      }

      throw createHttpError(500, "Something went wrong during authentication", {
        data: [],
        includeErrorField: true,
        originalMessage: error.message,
      });
    }
  },
  POSTGenerateIRN_GSTHero: async (req, res) => {
    try {
      const { accInvId, accessToken } = req.body;

      if (!accInvId || !accessToken) {
        return res.status(400).send({
          success: false,
          message: "Missing required parameter: accInvId or accessToken",
          data: [],
        });
      }

      await sql.connect(config); // Make sure `config` is defined properly

      // Get the JSON payload from stored procedure
      const result =
        await sql.query`EXEC einvoicing_GSTHero @account_invoice_id = ${accInvId}`;
      const jsonOutput = result.recordset
        .map((row) => row[Object.keys(row)[0]])
        .join("");

      if (!jsonOutput) {
        return res.send({
          success: true,
          message: "No invoice data found for IRN generation.",
          data: [],
        });
      }

      // // Fetch additional header data
      // const [serverLinkResult, gstinResult, authTokenResult, xConnectorResult] = await Promise.all([
      //   sql.query`SELECT ISNULL(einvoice_server_link, '') AS link FROM tbl_company_branch_parameter_mst WHERE branch_id = ${process.env.BRANCH_ID}`,
      //   sql.query`SELECT ISNULL(gstin, '') AS gstin FROM tbl_company_branch_parameter_mst WHERE branch_id = ${process.env.BRANCH_ID}`,
      //   sql.query`SELECT ISNULL(AuthToken, '') AS token FROM tbl_company_branch_parameter_mst WHERE branch_id = ${process.env.BRANCH_ID}`,
      //   sql.query`SELECT ISNULL(XConnectorAuthToken, '') AS token FROM tbl_company_branch_parameter_mst WHERE branch_id = ${process.env.BRANCH_ID}`,
      // ]);

      // Fetch supporting data
      const [serverLinkResult, gstinResult, tokenResult, xConnectorResult] =
        await Promise.all([
          sql.query`SELECT ISNULL(einvoiceServerLink, '') AS link FROM tblCompanyBranchParameter WHERE companyBranchId= = ${process.env.BRANCH_ID}`,
          sql.query`SELECT ISNULL(gstNo, '') AS gstin FROM tblCompanyBranchParameter WHERE companyBranchId= = ${process.env.BRANCH_ID}`,
          sql.query`SELECT ISNULL(AuthToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId== ${process.env.BRANCH_ID}`,
          sql.query`SELECT ISNULL(xconnectorAuthToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId= ${process.env.BRANCH_ID}`,
        ]);

      const generateIRNLink = `${serverLinkResult.recordset[0].link}/invoice`;
      const gstin = gstinResult.recordset[0].gstin;
      const authToken = `Bearer ${authTokenResult.recordset[0].token}`;
      const xConnectorToken = xConnectorResult.recordset[0].token;

      // Send POST request to GSTHero IRN API
      const response = await axios.post(generateIRNLink, jsonOutput, {
        headers: {
          "X-Connector-Auth-Token": xConnectorToken,
          Authorization: authToken,
          gstin: gstin,
          action: "GENERATEIRN",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      return res.send({
        success: true,
        message: "IRN generated successfully!",
        data: response.data,
      });
    } catch (error) {
      console.error("Error in POSTGenerateIRN_GSTHero:", error);
      return res.status(500).send({
        success: false,
        message: "Something went wrong during IRN generation",
        data: [],
        error: error.message,
      });
    }
  },

  CancelanIRN_GSTHero: async (req, res) => {
    try {
      const accInvId = req.body.invoiceId;
      const { billingPartyId, companyId } = req.body;

      if (!accInvId) {
        return res.status(400).send({
          success: false,
          message: "Missing required parameter: accInvId",
          data: [],
        });
      }
      // check IRN is generated or not
      const irnResult = await executeQuery(
        `
        EXEC CheckIRNStatus @InvoiceId = ${accInvId};
      `,
        {}
      );

      if (!irnResult.recordset[0].isIRN == "true") {
        return res.send({
          success: false,
          message: "IRN is not generated yet",
          data: [],
        });
      }
      // 1. Call the stored procedure to get the JSON string
      const jsonResult = await executeQuery(
        `
        EXEC irn_cancellation_gsthero @account_invoice_id = ${accInvId}
      `,
        {}
      );

      const jsonOutput = jsonResult.recordset
        .map((row) => Object.values(row)[0])
        .join("");

      if (!jsonOutput) {
        return res.send({
          success: false,
          message: "No JSON data found from stored procedure",
          data: [],
        });
      }
      //  Fetch auth credentials
      const resultPreAuth = await module.exports.Pre_AuthenticationResponse(
        req,
        res
      );
      //  Authenticate with GSTHero
      const authRespons =
        await module.exports.getAuthenticationResponse_GSTHero(req, res);

      // 2. Fetch configuration values from DB
      const [serverLinkResult, gstinResult, tokenResult, xConnectorResult] =
        await Promise.all([
          executeQuery(
            `SELECT ISNULL(einvoiceServerLink, '') AS link FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(gstNo, '') AS gstin FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(authToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId=${loginBranch}`,
            {}
          ),
          executeQuery(
            `SELECT ISNULL(xconnectorAuthToken, '') AS token FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
            {}
          ),
        ]);

      const serverLink = serverLinkResult.recordset[0].link;
      const gstin = gstinResult.recordset[0].gstin;
      const authToken = `Bearer ${tokenResult.recordset[0].token}`;
      const xConnectorAuthToken = xConnectorResult.recordset[0].token;

      const cancelIRNUrl = `${serverLink}/invoice/cancel`;

      // 3. Make POST request to cancel IRN
      const response = await fetch(cancelIRNUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: authToken,
          "X-Connector-Auth-Token": xConnectorAuthToken,
          gstin: gstin,
          action: "CANCELIRN",
        },
        body: jsonOutput,
      });

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: Response.error.map((err) => err.errorMsg).join(", "),
        });
      }
      let result = await response.json();
      // update invoice Table ( fields are not Proper need to work on it )
      await executeQuery(
        `UPDATE tblInvoice set cancelIrnNo=${result.cancelIrnNo} where id=${accInvId}`,
        {}
      );

      return res.send({
        success: true,
        message: "IRN cancellation successful",
        data: response.data,
      });
    } catch (error) {
      console.error("Error in CancelanIRN_GSTHero:", error);
      return res.status(500).send({
        success: false,
        message: "Something went wrong during IRN cancellation",
        data: [],
        error: error.message,
      });
    }
  },
};
