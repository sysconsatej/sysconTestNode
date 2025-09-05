const validate = require("../helper/validate");
const {
  executeQuery,
  executeStoredProcedure,
  executeNonJSONStoredProcedure,
} = require("../modelSQL/model");
const maxAllowedSizeInBytes = 1024 * 1024 * 1024;
const { errorLogger } = require("../helper/loggerService");
const getFolderSize = require("../helper/getFolderSize");
const path = require("path");
const moment = require("moment"); // Assuming you use moment for the timestamp

module.exports = {
  DisPlaySeacrchApi: async (req, res) => {
    const validationRule = { tableName: "required", menuID: "required" };
    // validate for validation according to validationRule
    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        return res
          .status(403)
          .send({ success: false, message: "Validation Error...!", data: err });
      }
      try {
        const {
          label,
          menuID,
          order,
          searchQuery,
          tableName,
          search,
          keyName,
          keyValue,
          loginBranch,
          loginCompany,
          loginfinYear,
        } = req.body;
        let pageNo = parseInt(req.body.pageNo, 10) || 1; // Default to page 1 if not specified
        let limit = parseInt(req.body.limit, 10) || 10; // Default to 10 items per page if not specified
        let parameter = {
          clientId: req.clientId,
          tableName: tableName,
          columnName: null,
          filterCondition: null,
          sortingOrder: null,
          search: null,
          menuId: menuID,
          pageSize: limit,
          pageNumber: pageNo,
          loginCompanyBranchId: loginBranch,
          loginCompanyId: loginCompany,
          loginfinYearId: loginfinYear,
        };
        let query = ``;
        if (
          keyName &&
          keyName !== "" &&
          keyName !== "undefined" &&
          keyValue &&
          keyValue !== "" &&
          keyValue !== "undefined"
        ) {
          parameter.columnName = keyName;
          parameter.search = keyValue;
        } else if (
          searchQuery &&
          searchQuery !== "undefined" &&
          searchQuery !== ""
        ) {
          parameter.globalSearch = searchQuery;
        }

        if (search && typeof search == "object") {
          for (const key of Object.keys(search)) {
            query += ` and ${key} = '${search[key]}'`;
          }
          parameter.filterCondition = query;
        }
        if (
          label &&
          label !== "undefined" &&
          label !== "" &&
          order &&
          order !== "undefined" &&
          order !== ""
        ) {
          parameter.sortingOrder = `${order == 1 ? "asc" : "desc"}`;
          parameter.sortingColumn = label;
        }

        let count = await executeQuery(
          `select count(*) as total from ${tableName} where status = 1 and clientId in ( ${req.clientId}, (select id from tblClient where clientCode = 'SYSCON') )` +
            query,
          {}
        );
        console.log(count.recordset[0].total === 0);

        if (count.recordset[0].total === 0) {
          return res.send({
            success: true,
            message: "No data found",
            data: [],
            count: count.recordset[0].total,
          });
        }
        console.log("=>", parameter);
        let data = await executeStoredProcedure("dynamicSearchApi", parameter);
        let parameterForCount = {
          ...parameter,
          pageSize: 1001,
          pageNumber: 1,
        };
        let getDataCount = await executeStoredProcedure(
          "dynamicSearchApi",
          parameterForCount
        );
        console.log("=>", getDataCount?.length);
        if (data.length > 0) {
          return res.send({
            success: true,
            message: "Data fetched successfully....!",
            data: data,
            //Count: count.recordset[0].total,
            Count: getDataCount?.length,
          });
        }
        res.send({ success: true, message: "No data found", data: data });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Error - " + error.message,
          data: [],
          error: error.message,
        });
      }
    });
  },
  createMaster: async (req, res) => {
    try {
      req.body.companyId = req.body.loginCompany;
      req.body.companyBranchId = req.body.loginBranch;
      req.body.financialYearId = req.body.loginfinYear;
      let data = await executeNonJSONStoredProcedure("insertDataApi", {
        json: JSON.stringify(req.body),
        formId: req.body.menuID,
        clientId: req.clientId,
        createdBy: req.userId,
        loginCompanyId: req.body.loginCompany,
        loginCompanyBranchId: req.body.loginBranch,
        finYearId: req.body.loginfinYear,
      });
      res.send({
        success: true,
        message: "Data Inserted Successfully",
        data: data,
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
  infoData: async (req, res) => {
    try {
      let query = {
        clientID: req.clientId || 4,
        menuID: req.body.menuID,
        recordID: req.body.id,
      };
      let data = await executeStoredProcedure("dynamicFetchApi", query);
      data.length > 0
        ? res.send({ success: true, message: "list fetched", data: data })
        : res
            .status(403)
            .send({ success: false, message: "No Data Found", data: [] });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  delete: async (req, res) => {
    const validationRule = {
      tableName: "required",
      id: "required",
      clientId: "required",
    };
    // validate for validation according to validationRule
    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        return res
          .status(403)
          .send({ success: false, message: "Validation Error...!", data: err });
      }
      try {
        let query = `select * from ${req.body.tableName} where id = ${req.body.id} and clientId = ${req.body.clientId}`;
        let deleteCheck = await executeQuery(query, {});
        if (deleteCheck.recordset.length == 0) {
          return res.send({
            success: false,
            message:
              "This data is restricted for you. Deletion is not allowed.",
            data: [],
          });
        }
        let data = await executeNonJSONStoredProcedure("spDeleteRecord", {
          tableName: req.body.tableName,
          recordID: req.body.id,
          clientId: req.body.clientId,
        });
        res.send({
          success: true,
          message: "Data Deleted Successfully",
          data: data,
        });
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Error - " + error.message,
          data: [],
          error: error.message,
        });
      }
    });
  },
  upLoadFile: async (req, res) => {
    try {
      let responce = {};
      if (getFolderSize(`./public/api/images`) >= maxAllowedSizeInBytes) {
        responce.success = false; // Update flag since response is being sent
        responce.message +=
          "Your storage capacity has surpassed the 1GB limit. Kindly consider upgrading your plan.";
      } else {
        //                // console.log(Array.isArray(req.files.documents));
        //                console.log(req.files);
        if (req.files && req.files["documents"]) {
          const file = req.files["documents"]; // Adjust the field name based on your form
          // const allowedExtensions = /\.(png|jpg|jpeg|pdf|doc|xls|txt)$/i;
          const allowedExtensions =
            /\.(png|jpg|jpeg|pdf|doc|docx|xls|xlsx|txt|json|xml|ppt|pptx)$/i;
          // Check file extension
          if (!allowedExtensions.test(file.name)) {
            responce.success = false; // Update flag since response is being sent

            // responce.message = 'Sorry, the file type you provided is invalid. Please upload a file with one of the following extensions: .png, .jpg, ,.jpeg, .pdf, .doc, .xls, .txt.'
            responce.message =
              "Sorry, the file type you provided is invalid. Please upload a file with one of the following extensions: .png, .jpg, .jpeg, .pdf, .doc, .docx, .xls, .xlsx, .txt, .json, .xml, .ppt, .pptx.";
            // break; // Break out of the loop
          }
          // Check file size
          else if (file.size > 1024 * 1024) {
            // 1MB in bytes
            responce.success = false; // Update flag since response is being sent

            responce.message =
              "The file size exceeds the maximum limit of 1MB.";

            // break; // Break out of the loop
          } else {
            var element = req.files["documents"];

            // Use path module to get the extension
            const extension = path.extname(element.name);
            //console.log(extension);
            // Use path module to get the file name without extension
            const fileNameWithoutExt = path.basename(element.name, extension);
            //console.log(fileNameWithoutExt);
            // var image_name = moment().format("YYYYMMDDHHmmssSSS") + element.name;
            var image_name =
              fileNameWithoutExt +
              moment().format("YYYYMMDDHHmmssSSS") +
              extension;
            element.mv(
              `./public/api/images/${req.clientCode}/` + image_name.trim()
            );
            // insertData["documents"] = image_name; // Store the processed file name
            responce.success = true; // Update flag since response is being sent
            responce.message = "File uploaded successfully.";
            responce.data = {
              path: `api/images/${req.clientCode}/` + image_name,
              status: 1,
            };
          }
        }
      }
      res.status(responce.success ? 200 : 403).send(responce);
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
