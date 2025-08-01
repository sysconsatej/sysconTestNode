// logger.js
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });

const fielLogger = (req, res, next) => {
    const log = `${new Date().toISOString()} | ${req.method} ${req.originalUrl} | IP: ${req.ip}\n`;
    logStream.write(log);
    next();
};


const logger = winston.createLogger({
    level: 'error',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.prettyPrint()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log' }),
    ],
    exceptionHandlers: [
        new winston.transports.File({ filename: 'exceptions.log' })
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: 'rejections.log' })

    ]

});



function handleCrashes() {

    process.on('uncaughtException', (err) => {
        if(err instanceof ReferenceError) {
            console.log("dfnvfnnninkjsdnvkjbsjhsdvb")  
            logger.error('Refernce Error:' , err)  
        }
        logger.error('Uncaught Exception:', err);
        // fs.appendFileSync('crash.log', `${new Date().toISOString()} | UncaughtException: ${err.stack}\n`);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection:', reason);
        // fs.appendFileSync('crash.log', `${new Date().toISOString()} | UncaughtException: ${err.stack}\n`);
        process.exit(1);
    });


}




module.exports = { handleCrashes  , fielLogger};
