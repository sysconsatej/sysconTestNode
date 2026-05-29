const rateLimit = require("express-rate-limit");
const logger = require("../config/loggerService");

const limiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 100000,

  handler: (req, res) => {
    logger.warn("Rate limit exceeded", {
      id: req.userId,
      url: req.originalUrl,
    });

    res.status(429).json({
      message: "Too many requests, please try again later.",
    });
  },
});

module.exports = limiter;