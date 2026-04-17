const morgan = require("morgan");
const logger = require("../config/loggerService");

const stream = {
  write: (message) => logger.info(message.trim()),
};

const httpLogger = morgan(
  ":method :url :status :response-time ms",
  { stream }
);

module.exports = httpLogger;