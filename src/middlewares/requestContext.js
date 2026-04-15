const logger = require("../config/loggerService");
const getClientIp = require("../utils/getClientIp");

const requestContext = (req, res, next) => {
    const ip = getClientIp(req);

    req.log = (level, message, meta = {}) => {
        logger.log(level, message, {
            ip,
            method: req.method,
            url: req.originalUrl,
            ...meta,
        });
    };

    next();
}

module.exports = requestContext;