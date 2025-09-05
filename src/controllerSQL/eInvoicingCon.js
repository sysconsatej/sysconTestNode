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
  const data = await executeStoredProcedure("getInvoiceForVoucher", {
    invoiceId,
  });

  console.log("generateIRNFunction data:", data);
  return data;
};

module.exports = {
  isEInvoicing: async (req, res) => {
    try {
      const { invoiceId, billingPartyId, companyId } = req.body;

      if (!invoiceId || !billingPartyId || !companyId) {
        return res.status(400).send({
          success: false,
          message:
            "Missing required parameter: invoiceId , billingPartyId, companyId",
          data: [],
        });
      }

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
      const resultPreAuth = await module.exports.Pre_AuthenticationResponse(
        req,
        res
      );
      // Step 3: Authenticate with GSTHero
      const authRespons =
        await module.exports.getAuthenticationResponse_GSTHero(req, res);
      const accessToken = authRespons.access_token;
      const gstin = authRespons.gstin;

      // Step 4: Fetch invoice data
      const invoiceData = await executeStoredProcedure("getInvoiceForVoucher", {
        // invoiceId,
        clientId: req.clientId,
        billingPartyId: req.body.billingPartyId,
        companyId: req.body.companyId,
      });

      if (!invoiceData || invoiceData.length === 0) {
        return res.send({
          success: true,
          message: "No invoice data found",
          data: [],
        });
      }

      // Step 5: Send data to generate IRN
      const irnResponse = await fetch(
        "https://gsthero.com/einvoice/generate-irn",
        {
          // Replace with actual GSTHero endpoint
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            gstin: gstin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(invoiceData[0]),
        }
      );
      const Response = await irnResponse.json();
      if (!irnResponse.ok) {
        return res.status(irnResponse.status).json({
          success: false,
          message: Response.error.map((err) => err.errorMsg).join(", "),
        });
      }
      const { ackDate, ackNo, irn, signedQrCode, signedInvoice } = Response;
      let updateQuery = `UPDATE tblInvoice set ackDate='${ackDate}', ackNo='${ackNo}', irn='${irn}', signedQrCode='${signedQrCode}', signedInvoice='${signedInvoice}'  where id=${invoiceId}`;
      await executeQuery(updateQuery, {});

      // Step 6: Return response
      return res.send({
        success: true,
        message: "IRN generation completed",
        isEinvoicing,
        irnResponse: irnResponse.data,
      });
    } catch (error) {
      console.error("Error in isEInvoicing:", error);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        error: error.message,
      });
    }
  },

  // Optional: Keep this route for independent IRN generation
  generateIRN: async (req, res) => {
    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        return res.status(400).send({
          success: false,
          message: "Missing required parameter: invoiceId",
          data: [],
        });
      }

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
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  Pre_AuthenticationResponse: async (req, res) => {
    try {
      const accInvId = req.body.invoiceId;
      const { loginBranch } = req.body;

      if (!accInvId) {
        return res.status(400).send({
          success: false,
          message: "Missing required parameter: accInvId",
          data: [],
        });
      }

      // await sql.connect(config); // Make sure you have this connection config ready

      // Step 1: Fetch username, password, client_id, scope, gstin
      const credentialsResult = await executeQuery(
        `
       
select  c.gstHeroUsername as username,c.gstHeroPassword as password ,c.gstHeroClientId as client_id,c.scope as scope,c.gstNo as gstin  from tblinvoice a inner join tblCompanyBranchParameter c on a.companyBranchId= c.companyBranchId where a.id= ${accInvId}
      `,
        {}
      );

      if (!credentialsResult.recordset.length) {
        return res.status(404).send({
          success: false,
          message: "No credentials found for the given account invoice ID",
          data: [],
        });
      }

      const { username, password, client_id, scope, gstin } =
        credentialsResult.recordset[0];
      if (!username || !password || !client_id || !scope || !gstin) {
        return res.status(400).send({
          success: false,
          message:
            "Missing required parameters: username, password, client_id, scope, gstin",
          data: [],
        });
      }
      // Step 2: Fetch server link & basic authorization key
      const [serverLinkResult, authKeyResult] = await Promise.all([
        executeQuery(
          `SELECT ISNULL(einvoiceServerLink, '') AS link FROM tblCompanyBranchParameter WHERE companyBranchId= ${loginBranch}`,
          {}
        ),
        executeQuery(
          `SELECT ISNULL(basicAuthKey, '') AS keys FROM tblCompanyBranchParameter WHERE companyBranchId = ${loginBranch}`,
          {}
        ),
      ]);

      const serverLink = "https://gsthero.com";
      const basicAuthKey = authKeyResult.recordset[0]?.keys;

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
          gstin: gstin,
          Authorization: basicAuthKey,
        },
      });
      const responseData = await response.json();
      console.log("Pre_AuthenticationResponse:", responseData);

      if (!response.ok) {
        // console.log("Pre_AuthenticationResponse:", response);
        return res.send({
          success: true,
          message: "Pre-authentication response fetched successfully",
          data: responseData.error_description,
        });
      }
      let updateQuery = `update tblCompanyBranchParameter set preAuthToken='${responseData.access_token}' where companyBranchId=${loginBranch}`;
      await executeQuery(updateQuery, {});

      return {
        ...responseData,
        success: true,
        message: "Pre-authentication response fetched successfully",
        data: [],
      };
    } catch (error) {
      console.error("Error in Pre_AuthenticationResponse:", error);
      return res.status(500).send({
        success: false,
        message: "Something went wrong during pre-authentication",
        data: [],
        error: error.message,
      });
    }
  },

  getAuthenticationResponse_GSTHero: async (req, res) => {
    try {
      const accInvId = req.body.invoiceId;
      const { loginBranch } = req.body;

      if (!accInvId) {
        return res.status(400).send({
          success: false,
          message: "Missing required parameter: accInvId",
          data: [],
        });
      }

      // Connect to SQL Server
      // await sql.connect(config); // config should be defined elsewhere securely

      // Get JSON payload from stored procedure
      const result = await executeQuery(
        `EXEC einvoicing_gsthero_auth @invoiceId = ${accInvId}, @branchid = ${loginBranch}`,
        {}
      );
      console.log("AuthenticationResponse:", result.recordset);

      const jsonOutput = result.recordset
        .map((row) => row[Object.keys(row)[0]])
        .join("");

      if (!jsonOutput) {
        return res.send({
          success: true,
          message: "No authentication data found.",
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

      const requestUrl = `${serverLinkResult.recordset[0].link}/authentication`;
      const gstin = gstinResult.recordset[0].gstin;
      const preauthToken = `Bearer ${tokenResult.recordset[0].token}`;
      const xConnectorToken = xConnectorResult.recordset[0].token;

      // Make authentication request
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Connector-Auth-Token": xConnectorToken,
          Authorization: preauthToken,
          gstin: gstin,
          action: "ACCESSTOKEN",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: jsonOutput,
      });
      const responseData = await response.json();
      console.log("AuthenticationResponse:", responseData);
      if (!response.ok) {
        return res.send({
          success: true,
          message: "Authentication response fetched successfully!",
          data: responseData.error_description,
        });
      }
      let updateQuery = `update tblCompanyBranchParameter set authToken='${responseData.access_token}' where companyBranchId=${loginBranch}`;
      await executeQuery(updateQuery, {});
      return {
        ...responseData,
        gstin,
        success: true,
        message: "Authentication response fetched successfully!",
        data: [],
      };

      // return res.send({
      //   success: true,
      //   message: "Authentication response fetched successfully!",
      //   data: response.data,
      // });
    } catch (error) {
      console.error("Error in getAuthenticationResponse_GSTHero:", error);
      res.status(500).send({
        success: false,
        message: "Something went wrong during authentication",
        data: [],
        error: error.message,
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
