const {
    executeDynamicJsonStoredProcedure,
} = require("../modelSQL/model");

module.exports = {
    uploadExcelFunc: async (req, res) => {
        try {
            const { spName, filterCondition } = req.body;

            if (!spName) {
                return res.status(400).json({
                    success: false,
                    message: "spName is required",
                });
            }

            if (!filterCondition) {
                return res.status(400).json({
                    success: false,
                    message: "filterCondition is required",
                });
            }

            let payload;

            if (typeof filterCondition === "string") {
                try {
                    payload = JSON.parse(filterCondition);
                } catch {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid JSON in filterCondition",
                    });
                }
            } else {
                payload = filterCondition;
            }

            // Validate the exact structure expected by SQL
            if (!Array.isArray(payload?.excelUploads)) {
                return res.status(400).json({
                    success: false,
                    message: "filterCondition.excelUploads must be an array",
                });
            }

            const response = await executeDynamicJsonStoredProcedure(
                spName,
                payload,
                "json"
            );

            return res.status(200).json({
                success: response.success,
                message: response.success
                    ? "Excel validation completed successfully"
                    : "Excel validation failed",
                length: (response.values || []).length,
                data: response.values || [],
                errors: response.errors || [],
            });
        } catch (error) {
            console.error("uploadExcelFunc error:", error);

            return res.status(500).json({
                success: false,
                message: "Failed to validate Excel upload",
                error: error.message,
            });
        }
    },
};