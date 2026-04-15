const rateLimit = require('express-rate-limit');
const logger = require("../config/loggerService");
const getClientIp = require("../utils/getClientIp");

const rateLimiter = rateLimit({
    windowMs:  10 * 60 * 1000, // 1 minute
    max: 100, // limit each IP to 20 requests per windowMs
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
        keyGenerator: (req) => {
            return req.ip; // safe because trust proxy = 1
        },

        handler: (req, res, next, options) => {
            const ip = getClientIp(req);
            logger.warn(
                {
                    message: "Too many requests",
                    ip,
                    method: req.method,
                    url: req.originalUrl,
            }
        );
        res.status(429).json({
            success: false,
            message: "Too many requests, please try again later.",
        });
    }
});

module.exports = rateLimiter;