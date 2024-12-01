const validate = require('../helper/validate')
const { executeQuery, executeStoredProcedure } = require("../modelSQL/model")

module.exports = {
    getMenuList: async (req, res) => {
        try {
            const { loginCompany, loginBranch, loginfinYear } = req.body
            let data = await executeStoredProcedure("menuRetrievalApi", { loginBranch, loginCompany, userId: req.userId })
            if (data.recordset.length > 0) {
                res.send({
                    success: true,
                    message: "Data Fetched Successfully",
                    data: JSON.parse(data.recordset[0]["JSON_F52E2B61-18A1-11d1-B105-00805F49916B"])
                })
            }
            else {
                res.send({
                    success: false,
                    message: "No Data Found",
                    data: []
                })
            }

        } catch (error) {
            res.status(500).send({
                success: false,
                message: "Something went wrong",
                data: error.message
            })
        }
    }
}