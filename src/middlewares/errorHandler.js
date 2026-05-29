const logger = require("../config/loggerService");

const errorHandler = (err, req, res, next) => {
    const id = req?.userId;

    logger.error({
        message: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        id,
    });

    res.status(err.status || 500).json({
        success: false,
        message: err.message || "Internal Server Error",
    });
};

module.exports = errorHandler;