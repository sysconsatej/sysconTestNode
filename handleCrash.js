
function handleCrashes() {

    process.on('uncaughtException', (err) => {
        if (err instanceof ReferenceError) {
            logger.error('Refernce Error:', err)
        }
        logger.error('Uncaught Exception:', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection:', reason);
        process.exit(1);
    });


}




module.exports = { handleCrashes };
