const validate = require('../helper/validate')
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model")

module.exports = {
    listControlToDrawScreen: async (req, res) => {
        const ValidationRule = {
            menuID: "required"
        }
        validate(req.query, ValidationRule, {}, async (err, status) => {
            if (!status) {
                return res.status(403).send({
                    success: false,
                    message: "validation Error",
                    data: err
                })
            }
            try {
                const { menuID } = req.query
                let parameter = { menuID: menuID , createForm: false }
                if (menuID == "CreateFormcontrol") {
                    parameter.menuID = 0
                    parameter.createForm = true
                }
                let data = await executeStoredProcedure('formRetrievalApi', parameter)
                let message = "Data fetched successfully....!"
                if (data) {
                    data = data
                }
                else {
                    message = "No data found"
                    data = []
                }
                return res.send({ success: true, message: message, data: data })
            } catch (error) {
                return res.status(200).send({
                    success: false,
                    message: "Something went wrong",
                    data: [],
                    error:error.message
                })
            }
        })
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
                    const { onfilterkey, referenceTable, onfiltervalue, referenceColumn, dropdownFilter, sortingOrder } = req.body
                    let data = await executeStoredProcedure('dynamicDataFetch', { clientId: 0, filterCondition: dropdownFilter || null, sortingOrder: sortingOrder || null, tableName: referenceTable, columnName: referenceColumn })
                    if (data.length > 0) {
                        return res.send({ success: true, message: "Data fetched successfully....!", data: data })
                    }
                    else {
                        return res.send({ success: true, message: "No data found", data: data })
                    }
                } catch (error) {
                    res.status(500).send({
                        success: false,
                        message: "Something went wrong",
                        data: error.message,
                    });
                }
            }
        })
    }
}