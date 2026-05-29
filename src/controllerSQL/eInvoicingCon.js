const validate = require("../helper/validate");
const model = require("../modelSQL/model");
const functionForCommaSeperated = require("../helper/CommaSeperatedValue");
const mongoose = require("mongoose");
const moment = require("moment");
const crypto = require("crypto");
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
  const rawBody = await response.json();

  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    return rawBody;
  }
}

function getMalaysiaSubmissionErrors(result) {
  const extractMessages = (details) =>
    Array.isArray(details)
      ? details.map((item) => item?.message).filter(Boolean)
      : [];

  const fromRejected =
    result?.rejectedDocuments?.flatMap((doc) =>
      extractMessages(doc?.error?.details)
    ) ?? [];
  if (fromRejected.length) {
    return fromRejected.join(", ");
  }

  const fromTopLevelError = extractMessages(result?.error?.details);
  if (fromTopLevelError.length) {
    return fromTopLevelError.join(", ");
  }

  const fromTopLevelDetails = extractMessages(result?.details);
  if (fromTopLevelDetails.length) {
    return fromTopLevelDetails.join(", ");
  }

  if (typeof result?.error?.message === "string" && result.error.message.trim()) {
    return result.error.message.trim();
  }
  if (typeof result?.message === "string" && result.message.trim()) {
    return result.message.trim();
  }
  if (typeof result?.error === "string" && result.error.trim()) {
    return result.error.trim();
  }

  return "";
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

function isDuplicateIrnResponse(responseData) {
  if (!responseData || !Array.isArray(responseData.error)) {
    return false;
  }

  const hasDuplicateErrorCode = responseData.error.some(
    (item) => String(item?.errorCodes || item?.errorCode || "") === "2150"
  );
  const infoCode = String(responseData?.info?.[0]?.InfCd || "").toUpperCase();

  return hasDuplicateErrorCode || infoCode === "DUPIRN";
}

function getIrnDetailsFromResponse(responseData) {
  const duplicateIrnDesc = responseData?.info?.[0]?.Desc || {};

  return {
    ackDate:
      responseData?.ackDate ||
      responseData?.AckDt ||
      duplicateIrnDesc?.AckDt ||
      duplicateIrnDesc?.ackDate,
    ackNo:
      responseData?.ackNo ||
      responseData?.AckNo ||
      duplicateIrnDesc?.AckNo ||
      duplicateIrnDesc?.ackNo,
    irn:
      responseData?.irn ||
      responseData?.Irn ||
      duplicateIrnDesc?.Irn ||
      duplicateIrnDesc?.irn,
    signedQrCode: responseData?.signedQrCode || responseData?.SignedQRCode,
    signedInvoice: responseData?.signedInvoice || responseData?.SignedInvoice,
  };
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
      const isEinvoicing = result?.recordset?.[0]?.isenvoicing || "n";

      console.log("E-invoicing result:", result);

      if (isEinvoicing !== "y") {
        return res.send({
          success: true,
          message: "Invoice saved successfully but not eligible for e-invoicing",
          isEinvoicing,
        });
      }

      // Route by provider (GSTHero vs MyInvois Malaysia) based on tblCompanyParameter
      const providerResult = await executeQuery(
        `SELECT ISNULL(gstSuvidhaProvider, '') AS provider FROM tblCompanyParameter WHERE companyId = ${Number(
          companyId
        )}`,
        {}
      );
      const provider = String(
        providerResult?.recordset?.[0]?.provider || ""
      ).toUpperCase();

      console.log("Resolved e-invoicing provider:", provider);

      if (provider === "MALAYSIA") {
        const malaysiaResult = await module.exports.eInvoicing_Malaysia({
          accInvId: invoiceId,
          branchId: req.body.loginBranch,
          companyId,
        });

        return res.send({
          success: true,
          isEinvoicing,
          provider,
          ...malaysiaResult,
        });
      }

      // Step 2: Fetch auth credentials
      await module.exports.Pre_AuthenticationResponse(req);

      // Step 3: Authenticate with GSTHero
      const authRespons =
        await module.exports.getAuthenticationResponse_GSTHero(req);

      const accessToken = authRespons?.access_token;
      const gstin = authRespons?.gstin;
      const serverLink = authRespons?.serverLink;
      const connectorToken = authRespons?.xConnectorResult;

      if (!accessToken || !gstin || !serverLink || !connectorToken) {
        throw createHttpError(400, "GSTHero authentication details are missing", {
          data: authRespons,
        });
      }

      // Step 4: Fetch invoice data
      const invoiceData = await executeStoredProcedure("einvoicingGSTHero", {
        invoiceId,
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
          "X-Connector-Auth-Token": connectorToken,
          gstin,
          "Content-Type": "application/json",
          action: "GENERATEIRN",
        },
        body: JSON.stringify(invoiceData),
      });

      const irnResponseRaw = await parseJsonResponse(irnResponse);

      console.log("IRN generation raw response from GSTHero:", irnResponseRaw);
      console.log("Type of IRN response:", typeof irnResponseRaw);
      console.log("Is array:", Array.isArray(irnResponseRaw));

      let irnResponseData = irnResponseRaw;

      if (typeof irnResponseData === "string") {
        try {
          irnResponseData = JSON.parse(irnResponseData);
        } catch (e) {
          console.log("Failed to parse IRN response string:", e.message);
        }
      }

      if (Array.isArray(irnResponseData)) {
        irnResponseData = irnResponseData[0] || {};
      }

      if (irnResponseData?.data) {
        irnResponseData = irnResponseData.data;
        if (Array.isArray(irnResponseData)) {
          irnResponseData = irnResponseData[0] || {};
        }
      }

      if (irnResponseData?.result) {
        irnResponseData = irnResponseData.result;
        if (Array.isArray(irnResponseData)) {
          irnResponseData = irnResponseData[0] || {};
        }
      }

      console.log("Normalized IRN response:", irnResponseData);
      console.log(
        "Normalized IRN response keys:",
        Object.keys(irnResponseData || {})
      );

      if (!irnResponse.ok) {
        throw createHttpError(
          irnResponse.status || 502,
          getGstHeroErrorMessage(
            irnResponseData,
            "IRN generation failed at GSTHero"
          ),
          { data: [] }
        );
      }

      if (irnResponseData?.error && irnResponseData.error.length > 0) {
        if (!isDuplicateIrnResponse(irnResponseData)) {
          const errorMessage = getGstHeroErrorMessage(
            irnResponseData,
            "IRN generation failed with errors from GSTHero"
          );
          throw createHttpError(400, errorMessage, { data: [] });
        }
      }

      const AckDt = irnResponseData?.AckDt || null;
      const AckNo = irnResponseData?.AckNo || null;
      const Irn = irnResponseData?.Irn || null;
      const SignedQRCode = irnResponseData?.SignedQRCode || null;
      const SignedInvoice = irnResponseData?.SignedInvoice || null;

      console.log("Extracted IRN values:", {
        AckDt,
        AckNo,
        Irn,
        SignedQRCode: !!SignedQRCode,
        SignedInvoice: !!SignedInvoice,
      });

      if (!AckDt && !AckNo && !Irn && !SignedQRCode && !SignedInvoice) {
        throw createHttpError(
          400,
          "IRN response received, but required fields could not be extracted",
          { data: irnResponseData }
        );
      }

      const irnResponseJson =
        irnResponseData && Object.keys(irnResponseData).length > 0
          ? `'${escapeSqlString(JSON.stringify(irnResponseData))}'`
          : "NULL";

      const updateQuery =
        "UPDATE tblInvoice SET " +
        "ackDate = " + (AckDt ? `'${escapeSqlString(AckDt)}'` : "NULL") + "," +
        "ackNo = " + (AckNo ? `'${escapeSqlString(String(AckNo))}'` : "NULL") + "," +
        "irn = " + (Irn ? `'${escapeSqlString(Irn)}'` : "NULL") + "," +
        "signedQrCode = " + (SignedQRCode ? `'${escapeSqlString(SignedQRCode)}'` : "NULL") + "," +
        "signedInvoice = " + (SignedInvoice ? `'${escapeSqlString(SignedInvoice)}'` : "NULL") + "," +
        "irnResponse = " + irnResponseJson + " " +
        "WHERE id = " + invoiceId;

      await executeQuery(updateQuery, {});

      return res.send({
        success: true,
        message: isDuplicateIrnResponse(irnResponseData)
          ? "Duplicate IRN found and invoice updated"
          : "IRN generation completed",
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
      const { invoiceId, reasonId, remark } = req.body;

      requireFields(req.body, ["invoiceId", "companyId", "loginBranch", "reasonId"]);

      const result = await executeNonJSONStoredProcedure("isEinvoicing", {
        invoiceId,
      });
      const isEinvoicing =
        String(result?.recordset?.[0]?.isenvoicing || "n").toLowerCase();

      console.log("Cancel IRN e-invoicing result:", result);

      if (isEinvoicing !== "y") {
        return res.send({
          success: true,
          message: "Innvoice Deleted successfully but not eligible for e-invoicing",
          isEinvoicing,
        });
      }

      const irnResult = await executeQuery(
        `
        EXEC CheckIRNStatus @InvoiceId = ${invoiceId};
      `,
        {}
      );

      const isIRNGenerated = String(
        irnResult?.recordset?.[0]?.isIRN || ""
      ).toLowerCase();

      if (isIRNGenerated !== "true") {
        return res.send({
          success: false,
          message: "IRN is not generated yet",
          data: [],
        });
      }

      const reason = await executeQuery(`SELECT name , code from tblMasterData where masterListName = 'tblReason' and id=${req.body.reasonId}`, {});
      console.log("Fetched reason for cancellation:", reason);
      const reasonCode = reason?.recordset?.[0]?.code;
      const jsonResult = await executeQuery(
        `
        EXEC irnCancellationGsthero @invoiceId = ${invoiceId}
      `,
        {}
      );

      let jsonOutput = jsonResult.recordset
        .map((row) => Object.values(row)[0])
        .join("");



      if (!jsonOutput) {
        throw createHttpError(
          404,
          "No JSON data found from stored procedure",
          {
            data: [],
          }
        );
      }
      jsonOutput = JSON.parse(jsonOutput);
      jsonOutput.Data.CnlRsn = reasonCode;
      jsonOutput.Data.CnlRem = remark;

      jsonOutput = JSON.stringify(jsonOutput);

      await module.exports.Pre_AuthenticationResponse(req);
      const authRespons = await module.exports.getAuthenticationResponse_GSTHero(
        req
      );

      const accessToken = authRespons.access_token;
      const gstin = authRespons.gstin;
      const serverLink = authRespons.serverLink;
      const xConnectorAuthToken =
        authRespons?.xConnectorResult?.recordset?.[0]?.token;

      if (!accessToken || !gstin || !serverLink || !xConnectorAuthToken) {
        throw createHttpError(
          404,
          "Authentication configuration is incomplete for the given branch",
          {
            data: [],
          }
        );
      }

      const cancelIRNUrl = `${serverLink}/invoice/cancel`;
      // return res.send({
      //   success: true,
      //   message: "IRN cancellation request sent successfully",
      //   jsonOutput: JSON.parse(jsonOutput),
      //   cancelIRNUrl,
      //   reason,
      //   reasonCode,
      // });

      const response = await fetch(cancelIRNUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Connector-Auth-Token": xConnectorAuthToken,
          gstin,
          "Content-Type": "application/json",
          Accept: "application/json",
          action: "CANCELIRN",
        },
        body: jsonOutput,
      });
      const cancelIrnResponse = await parseJsonResponse(response);
      console.log("Cancel IRN response from GSTHero:", JSON.stringify(cancelIrnResponse));

      if (!response.ok) {
        throw createHttpError(
          response.status || 502,
          getGstHeroErrorMessage(
            cancelIrnResponse,
            "IRN cancellation failed at GSTHero"
          ),
          {
            data: [],
          }
        );
      }

      if (
        cancelIrnResponse?.error &&
        Array.isArray(cancelIrnResponse.error) &&
        cancelIrnResponse.error.length > 0
      ) {
        throw createHttpError(
          400,
          getGstHeroErrorMessage(
            cancelIrnResponse,
            "IRN cancellation failed with errors from GSTHero"
          ),
          {
            data: [],
          }
        );
      }

      const cancelIrnNo = cancelIrnResponse?.data?.Irn
      const cancelDate = cancelIrnResponse?.data?.CancelDate


      if (cancelIrnNo) {
        await executeQuery(
          `UPDATE tblInvoice set cancelIrnNo='${escapeSqlString(
            cancelIrnNo
          )}', cancelDate='${escapeSqlString(cancelDate)}' where id=${invoiceId}`,
          {}
        );
      }

      return res.send({
        success: true,
        message: "IRN cancellation successful",
        isEinvoicing,
        cancelIrnResponse,
      });
    } catch (error) {
      console.error("Error in CancelanIRN_GSTHero:", error);
      if (res.headersSent) {
        return;
      }

      return sendError(res, error, {
        fallbackMessage: `Error - ${error.message}`,
      });
    }
  },

  AuthenticationResponse_Malaysia: async ({ branchId }) => {
    try {
      requireFields({ branchId }, ["branchId"]);

      const credentialsResult = await executeQuery(
        `SELECT
           ISNULL(eMalaysiaClientId, '')      AS eMalaysiaClientId,
           ISNULL(clientSecret, '')          AS clientSecret,
           ISNULL(grantType, '')             AS grantType,
           ISNULL(scope, '')                 AS scope,
           ISNULL(einvoiceServerLink, '')    AS einvoiceServerLink
         FROM tblCompanyBranchParameter
         WHERE companyBranchId = ${Number(branchId)}`,
        {}
      );

      if (!credentialsResult?.recordset?.length) {
        throw createHttpError(
          404,
          "No Malaysia e-invoicing credentials found for the given branch",
          { data: [] }
        );
      }

      const {
        eMalaysiaClientId,
        clientSecret,
        scope,
        grantType,
        einvoiceServerLink,
      } = credentialsResult.recordset[0];

      const client_id = String(eMalaysiaClientId || "").trim();

      if (!client_id) {
        throw createHttpError(
          400,
          "Malaysia eMalaysiaClientId is missing for this branch; please configure tblCompanyBranchParameter.",
          { data: [] }
        );
      }

      if (!einvoiceServerLink) {
        throw createHttpError(
          400,
          "Malaysia einvoiceServerLink is not configured for this branch.",
          { data: [] }
        );
      }

      const tokenUrl = `${einvoiceServerLink.replace(/\/$/, "")}/connect/token`;

      const formBody = new URLSearchParams({
        client_id,
        client_secret: clientSecret || "",
        scope: scope || "",
        grant_type: grantType || "client_credentials",
      }).toString();

      console.log(
        "Calling Malaysia OAuth token endpoint:",
        tokenUrl,
        "with client_id:",
        client_id,
        "scope:",
        scope,
        "grant_type:",
        grantType,
        formBody
      );

      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: formBody,
      });

      console.log("Malaysia OAuth token response:", tokenResponse);
      const tokenData = await parseJsonResponse(tokenResponse);
      console.log("Malaysia OAuth response:", tokenData);

      if (!tokenResponse.ok) {
        throw createHttpError(
          tokenResponse.status || 502,
          tokenData?.error_description ||
            tokenData?.error ||
            tokenData?.message ||
            "Malaysia OAuth token request failed",
          { data: tokenData ?? [] }
        );
      }

      const access_token = tokenData?.access_token;
      if (!access_token) {
        throw createHttpError(
          502,
          "Malaysia OAuth response did not contain access_token",
          { data: tokenData ?? [] }
        );
      }

      await executeQuery(
        `UPDATE tblCompanyBranchParameter
         SET authToken = '${escapeSqlString(access_token)}'
         WHERE companyBranchId = ${Number(branchId)}`,
        {}
      );

      return { access_token, einvoiceServerLink };
    } catch (error) {
      console.error("Error in AuthenticationResponse_Malaysia:", error);

      if (error.isOperational) {
        throw error;
      }

      throw createHttpError(
        500,
        "Something went wrong during Malaysia authentication",
        {
          data: [],
          includeErrorField: true,
          originalMessage: error.message,
        }
      );
    }
  },

  documentSubmission_Malaysia: async ({
    accInvId,
    einvoiceServerLink,
    accessToken,
  }) => {
    const invNoResult = await executeQuery(
      `SELECT ISNULL(CAST(invoiceNo AS NVARCHAR(500)), '') AS invoiceNumber
       FROM tblInvoice WHERE id = ${Number(accInvId)}`,
      {}
    );
    const invoiceNumber = String(
      invNoResult?.recordset?.[0]?.invoiceNumber ?? ""
    ).trim();

    const spRes = await executeQuery(
      `EXEC einvoicingMalaysia @accountInvoiceId = ${Number(accInvId)}`,
      {}
    );
    const jsonString = (spRes?.recordset ?? [])
      .map((row) => row[Object.keys(row)[0]] ?? "")
      .join("");

    if (!jsonString || !jsonString.trim()) {
      throw createHttpError(
        404,
        "No invoice JSON returned from einvoicingMalaysia for this invoice",
        { data: [] }
      );
    }

    const jsonBytes = Buffer.from(jsonString, "utf-8");
    const base64Document = jsonBytes.toString("base64");
    const documentHash = crypto
      .createHash("sha256")
      .update(jsonBytes)
      .digest("hex");

    const baseUrl = String(einvoiceServerLink || "").replace(/\/$/, "");
    const submitUrl = `${baseUrl}/api/v1.0/documentsubmissions/`;

    const body = {
      documents: [
        {
          format: "json",
          document: base64Document,
          documentHash,
          codeNumber: invoiceNumber,
        },
      ],
    };

    console.log("Submitting document to Malaysia endpoint:", submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    // return { submissionUid:'fsdfsfsdfsfsdfsdfsdfsd' }
    const submitResponse = await fetch(submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = await parseJsonResponse(submitResponse);
    console.log("Malaysia document submission response:", result);

    const submissionUid = result?.submissionUid;

    if (!submitResponse.ok || !submissionUid) {
      const errText = getMalaysiaSubmissionErrors(result);
      throw createHttpError(
        400,
        `There is error while generating IRN as ${errText || "unknown rejection from MyInvois"}, Please update the invoice again and check.`,
        { data: result ?? [] }
      );
    }

    await executeQuery(
      `UPDATE tblInvoice SET submissionUid = '${escapeSqlString(
        submissionUid
      )}' WHERE id = ${Number(accInvId)}`,
      {}
    );

    return { submissionUid };
  },

  documentSubmissionStatusCheck_Malaysia: async ({
    accInvId,
    einvoiceServerLink,
    accessToken,
    submissionUid,
  }) => {
    const baseUrl = String(einvoiceServerLink || "").replace(/\/$/, "");
    const statusUrl = `${baseUrl}/api/v1.0/documentsubmissions/${encodeURIComponent(
      submissionUid
    )}?pageNo=1&pageSize=10`;

    const statusResponse = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const statusPayload = await parseJsonResponse(statusResponse);
    console.log("Malaysia document submission status:", statusPayload);

    if (!statusResponse.ok) {
      const errText = getMalaysiaSubmissionErrors(statusPayload);
      throw createHttpError(
        statusResponse.status || 502,
        errText || "Malaysia submission status request failed",
        { data: statusPayload ?? [] }
      );
    }

    const { dateTimeReceived, documentSummary } = statusPayload || {};
    const uuidCombined = (documentSummary || [])
      .map((d) => d?.uuid ?? d?.UUID)
      .filter(Boolean)
      .join(" ");
    const longIdCombined = (documentSummary || [])
      .map((d) => d?.longId ?? d?.LongId)
      .filter(Boolean)
      .join(" ");

    if (!uuidCombined || !longIdCombined) {
      throw createHttpError(
        502,
        "Malaysia status response did not include uuid/longId in documentSummary; try again later.",
        { data: statusPayload ?? [] }
      );
    }

    // MyInvois public share URL — stored in tblInvoice.signedQrCode (same column as GST IRN QR payload)
    const malaysiaShareUrl = `https://myinvois.hasil.gov.my/${uuidCombined}/share/${longIdCombined}`;

    const finalUid = String(statusPayload?.submissionUid || submissionUid);
    const dtRecv = dateTimeReceived
      ? `'${escapeSqlString(String(dateTimeReceived))}'`
      : "NULL";

    await executeQuery(
      `UPDATE tblInvoice SET
         finalSubmissionUid = '${escapeSqlString(finalUid)}',
         [UUID] = '${escapeSqlString(uuidCombined)}',
         longId = '${escapeSqlString(longIdCombined)}',
         dateTimeReceived = ${dtRecv},
         signedQrCode = '${escapeSqlString(malaysiaShareUrl)}'
       WHERE id = ${Number(accInvId)}`,
      {}
    );

    return {
      submissionUid: finalUid,
      uuidCombined,
      longIdCombined,
      dateTimeReceived: dateTimeReceived || null,
      signedQrCode: malaysiaShareUrl,
    };
  },

  eInvoicing_Malaysia: async ({ accInvId, branchId, companyId }) => {
    requireFields({ accInvId, branchId }, ["accInvId", "branchId"]);

    const { access_token, einvoiceServerLink } =
      await module.exports.AuthenticationResponse_Malaysia({
        branchId,
      });

    const { submissionUid } =
      await module.exports.documentSubmission_Malaysia({
        accInvId,
        einvoiceServerLink,
        accessToken: access_token,
      });

    await new Promise((r) => setTimeout(r, 30 * 1000));

    const status = await module.exports.documentSubmissionStatusCheck_Malaysia(
      {
        accInvId,
        einvoiceServerLink,
        accessToken: access_token,
        submissionUid,
      }
    );

    return {
      message: "Malaysia e-invoice submitted successfully",
      submissionUid,
      ...status,
    };
  },
};
