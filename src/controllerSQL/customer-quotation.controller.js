const { executeQuery } = require("../modelSQL/model")


const getCustomerQuotationData = async (req, res) => {
    try {
        const queryToExcute = `exec customerQuotationCount ${req.clientId}`;
        const result = await executeQuery(queryToExcute);
        res.status(200).json({ success: true, data: result.recordset, message: "Customer quotation data fetched successfully." });
    } catch (error) {
        res.status(500).json({ error: "An error occurred while fetching customer quotation data." });
    }
}

module.exports = {
    getCustomerQuotationData
}