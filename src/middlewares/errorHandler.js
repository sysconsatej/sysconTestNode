const logger = require("../config/loggerService");
const getClientIp = require("../utils/getClientIp");

const errorHandler = (err, req, res, next) => {
    const ip = getClientIp(req);

    logger.error({
        message: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        ip,
    });

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error",
    });
};

module.exports = errorHandler;