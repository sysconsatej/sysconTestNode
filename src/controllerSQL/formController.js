const moment = require("moment");
const validate = require("../helper/validate");
const {
  executeQuery,
  executeStoredProcedure,
  executeNonJSONStoredProcedure,
} = require("../modelSQL/model");
async function controlDefalutValue(data, clientId) {
  if (data.controlname.toLowerCase() === "dropdown") {
    let result = await executeNonJSONStoredProcedure(
      "sp_GetControlDefaultValue",
      {
        ReferenceTable: data.referenceTable,
        ReferenceColumn: data.referenceColumn,
        controlDefaultValue: data.controlDefaultValue,
        clientId: clientId,
      }
    );
    return JSON.parse(result.recordset[0].controlDefaultValue) || "";
  } else if (
    ["date.now()", "Date.now()", "date.now", "Date.now"].includes(
      data.controlDefaultValue
    )
  ) {
    return moment().format("YYYY-MM-DD");
  }

  return data.controlDefaultValue;
}
module.exports = {
  listControlToDrawScreen: async (req, res) => {
    const ValidationRule = {
      menuID: "required",
    };
    validate(req.query, ValidationRule, {}, async (err, status) => {
      if (!status) {
        return res.status(403).send({
          success: false,
          message: "validation Error",
          data: err,
        });
      }
      try {
        const { menuID } = req.query;
        let parameter = {
          menuID: menuID,
          createForm: 0,
          clientId: req.clientId,
        };
        if (menuID == "CreateFormcontrol") {
          parameter.menuID = 895;
          parameter.createForm = 1;
        }
        let data = await executeStoredProcedure("formRetrievalApi", parameter);
        let message = "Data fetched successfully....!";
        if (data) {
          if (data.length > 0) {
            let tempVar = data[0];

            for (const element of tempVar.fields) {
              if (element.controlDefaultValue) {
                element.controlDefaultValue = await controlDefalutValue(
                  element,
                  req.clientId
                );
              }
            }
            for (const child of tempVar.child) {
              for (const element of child.fields) {
                if (element.controlDefaultValue) {
                  element.controlDefaultValue = await controlDefalutValue(
                    element,
                    req.clientId
                  );
                }
                for (const element of child.subChild) {
                  for (const element of child.fields) {
                    if (element.controlDefaultValue) {
                      element.controlDefaultValue = await controlDefalutValue(
                        element,
                        req.clientId
                      );
                    }
                  }
                }
              }
            }
            data = [tempVar];
          }
          data = data;
        } else {
          message = "No data found";
          data = [];
        }
        return res.send({ success: true, message: message, data: data });
      } catch (error) {
        return res.status(200).send({
          success: false,
          message: "Error - " + error.message,
          data: [],
          error: error.message,
        });
      }
    });
  },
  filterdDropDown: async (req, res) => {
    const validationRule = {
      // onfilterkey: "required",
      referenceTable: "required",
      // onfiltervalue: "required",
      referenceColumn: "required",
    };
    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        res.status(403).send({
          success: false,
          message: "validation Error",
          data: err,
        });
      } else {
        try {
          const {
            clientId,
            onfilterkey,
            referenceTable,
            onfiltervalue,
            referenceColumn,
            dropdownFilter,
            sortingOrder,
            search,
            pageNo,
            value,
            pageSize,
          } = req.body;
          console.log(dropdownFilter);
          const obj = pageSize  ?   {

            clientId: req.clientId || 4,
            filterCondition: dropdownFilter?.trim() || null,
            sortingOrder: sortingOrder || null,
            tableName: referenceTable.trim(),
            columnName: referenceColumn.trim(),
            search: search || null,
            pageNumber: pageNo || null,
            value: value || "",
            pageSize: pageSize,

          } :  {
            clientId: req.clientId || 4,
            filterCondition: dropdownFilter?.trim() || null,
            sortingOrder: sortingOrder || null,
            tableName: referenceTable.trim(),
            columnName: referenceColumn.trim(),
            search: search || null,
            pageNumber: pageNo || null,
            value: value || "",
          }
          let data = await executeStoredProcedure("dynamicDataFetch",  obj);
          let nextPage = data.length < 1001 ? null : pageNo + 1;
          // console.log(data);

          if (data.length > 0) {
            return res.send({
              success: true,
              message: "Data fetched successfully....!",
              data: data,
              nextPage: nextPage,
              prePage: pageNo - 1,
            });
          } else {
            return res.send({
              success: true,
              message: "No data found",
              data: data,
            });
          }
        } catch (error) {
          res.status(500).send({
            success: false,
            message: "Error - " + error.message,
            data: [],
            error: error.message,
          });
        }
      }
    });
  },
  dynamicFetch: async (req, res) => {
    const { clientID, recordID, menuID } = req.body;
    if (!clientID || !recordID || !menuID) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    try {
      let parameter = {
        clientID: clientID,
        recordID: recordID,
        menuID: menuID,
      };
      let data = await executeStoredProcedure("dynamicFetchApi", parameter);
      let message = "Data fetched successfully....!";
      let success = true;
      if (data.length > 0) {
        return res.send({ success: true, message: message, data: data });
      }
      return res.send({
        success: false,
        message: "Restricted access can not edit!",
        data: [],
      });
    } catch (error) {
      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  formList: async (req, res) => {
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
      } = req.body;
      let pageNo = parseInt(req.body.pageNo, 10) || 1; // Default to page 1 if not specified
      let limit = parseInt(req.body.limit, 10) || 10;
      let parameter = {
        clientId: req.clientId,
        tableName: "tblForm",
        columnName: null,
        filterCondition: null,
        sortingOrder: null,
        search: null,
        menuId: 895,
        pageSize: limit,
        pageNumber: pageNo,
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
        query += ` and ${keyName} like '%${keyValue}%'`;
      } else if (
        searchQuery &&
        searchQuery !== "undefined" &&
        searchQuery !== ""
      ) {
        parameter.globalSearch = searchQuery;
      }

      console.log("parameter", parameter);

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
        parameter.sortingOrder = `${label} ${order == 1 ? "asc" : "desc"}`;
      }

      if (req.body.id && req.body.id !== "undefined") {
        parameter.filterCondition = ` and id = ${req.body.id}`;
      }
      let count = await executeQuery(
        `select count(*) as total from tblForm where status = 1 and clientId in ( ${req.clientId},(select id from tblClient where clientCode = 'SYSCON')) ` +
        query,
        {}
      );
      if (count.recordset[0].total === 0) {
        return res.send({
          success: true,
          message: "No data found",
          data: [],
          count: count.recordset[0].total,
        });
      }
      let data = await executeStoredProcedure(
        "dynamicSearchApiCreateFormControl",
        parameter
      );
      if (data.length > 0) {
        return res.send({
          success: true,
          message: "Data fetched successfully....!",
          data: data,
          Count: count.recordset[0].total,
        });
      }
    } catch (error) {
      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  CreateFormControl: async (req, res) => {
    try {
      let data = await executeNonJSONStoredProcedure(
        "insertDataApiCreateFormControl",
        {
          json: JSON.stringify(req.body),
          formId: 895,
          clientId: req.clientId,
          createdBy: req.userId,
          loginCompanyId: req.body.loginCompany,
          loginCompanyBranchId: req.body.loginBranch,
          finYearId: req.body.loginfinYear,
        }
      );
      res.send({
        success: true,
        message: "Data Inserted Successfully",
        data: data,
      });
    } catch (error) {
      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },
  getCopyData: async (req, res) => {
    const validationRule = {
      id: "required",
      menuID: "required",
    };
    validate(req.body, validationRule, {}, async (err, status) => {
      if (!status) {
        return res.status(403).send({
          success: false,
          message: "Vaidation Error",
          data: err,
        });
      }
      try {
        let { id, menuID, filterValue } = req.body;
        let query = `select tctm.*, ISNULL((select * from tblCopyTableMapingFields where [status]=1 and copyTableMapingId=tctm.id for json path ),'[]') as fieldsMaping from tblCopyTableMaping as tctm WHERE tctm.[status]=1 and mappingName ='${id}' for json path`;
        let queryData = await executeQuery(query, {});
        console.log(queryData);

        let data = await executeStoredProcedure("GetCopyTableMapping", {
          mappingName: id,
          menuId: menuID,
          id: filterValue,
        });
        if (data.length > 0) {
          res.send({
            success: true,
            message: "Data fetched successfully....!",
            data: data,
            keyToValidate: JSON.parse(
              queryData.recordset[0][
              "JSON_F52E2B61-18A1-11d1-B105-00805F49916B"
              ]
            )[0],
          });
        }
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
  dropdownCreateForm: async (req, res) => {
    try {
      let parameter = { IsTable: 1 };
      if (req.body.dropdownFilter) {
        parameter = { IsTable: 0, TableName: req.body.dropdownFilter };
      }
      let data = await executeNonJSONStoredProcedure(
        "FetchDatabaseInfo",
        parameter
      );
      if (data.recordsets[0]?.length > 0) {
        return res.send({
          success: true,
          message: "Data fetched successfully....!",
          data: data.recordsets[0],
        });
      } else {
        return await module.exports.filterdDropDown(req, res);
      }
      res.send({
        success: true,
        message: "Data fetched successfully....!",
        data: data.recordsets[0],
      });
    } catch (error) {
      return res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: [],
        error: error.message,
      });
    }
  },

  disableEdit: async (req, res) => {
    try {
      const { tableName, recordId } = req.body;

      // Validate required fields
      if (!tableName || !recordId) {
        return res.status(400).send({
          success: false,
          message: "Table Name and Report Id are required.",
        });
      }
      const query = `disableEdit`;
      const parameters = {
        tableName,
        recordId
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.send({
          success: data[0].success,
          message: data[0].message
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
  disableAdd: async (req, res) => {
    try {
      const { tableName } = req.body;

      // Validate required fields
      if (!tableName) {
        return res.status(400).send({
          success: false,
          message: "Table Name are required.",
        });
      }
      const query = `disableAdd`;
      const parameters = {
        tableName
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.send({
          success: data[0].success,
          message: data[0].message
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
  validateSubmit: async (req, res) => {
    try {
      const { tableName, recordId } = req.body;

      // Validate required fields
      if (!tableName || !recordId) {
        return res.status(400).send({
          success: false,
          message: "Table Name and Report Id are required.",
        });
      }
      const query = `validateSubmit`;
      const parameters = {
        tableName,
        recordId
      };
      let data = await executeStoredProcedure(query, parameters);
      if (data) {
        res.send({
          success: data[0].success,
          message: data[0].message
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
  }
};
