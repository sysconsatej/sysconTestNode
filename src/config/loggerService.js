const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const fs = require("fs");

const logDir = "logs";

// ensure logs folder exists
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Common format
const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Daily rotate file for ALL logs
const allLogsTransport = new DailyRotateFile({
    filename: `${logDir}/combined-%DATE%.log`,
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,      // compress old logs
    maxSize: "20m",           // rotate if file exceeds 20MB
    maxFiles: "14d",          // keep logs for 14 days
});

// Daily rotate file for ERROR logs only
const errorLogsTransport = new DailyRotateFile({
    filename: `${logDir}/error-%DATE%.log`,
    datePattern: "YYYY-MM-DD",
    level: "error",
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
});

const logger = winston.createLogger({
    level: "info",
    format: logFormat,
    transports: [
        allLogsTransport,
        errorLogsTransport,
    ],
});

// Console logging in development
if (process.env.NODE_ENV !== "production") {
    logger.add(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        })
    );
}

module.exports = logger;