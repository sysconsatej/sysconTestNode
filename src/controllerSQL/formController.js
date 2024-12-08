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
                let data = await executeStoredProcedure('formRetrievalApi', { menuID: menuID })
                let message = "Data fetched successfully....!"
                if (data.recordset.length > 0) {
                    data = JSON.parse(data.recordset[0]["JSON_F52E2B61-18A1-11d1-B105-00805F49916B"])
                }
                else {
                    message = "No data found"
                    data = []
                }
                return res.send({ success: true, message: message, data: data })
            } catch (error) {
                return res.status(500).send({
                    success: false,
                    message: "Something went wrong",
                    data: error.message
                })
            }
        })
    }
}