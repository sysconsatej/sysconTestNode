const validate = require("../helper/validate");
const {
    executeQuery,
    executeStoredProcedure,
    executeNonJSONStoredProcedure,
} = require("../modelSQL/model");

module.exports = {
    BalanceSheetSp: async (req, res) => {
        try {
            const { fromDate, toDate, branchId } = req.body
            // Validate the input parameters
            let parameters = {
                fromDate: fromDate,
                toDate: toDate,
                branchId: branchId,
                clientId: req.clientId
            }
            let data = await executeNonJSONStoredProcedure("sp_BalanceSheet", parameters);
            if (data) {
                res.send({
                    success: true,
                    message: "Data Fetched Successfully",
                    count: data.length,
                    data: data,
                });
            } else {
                res.send({
                    success: false,
                    message: "No Data Found",
                    data: [],
                });
            }
        } catch (error) {
            console.error("Error in BlanceSheetSp:", error);
            res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });

        }
    }
}