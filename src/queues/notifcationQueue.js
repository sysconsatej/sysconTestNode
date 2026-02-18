const Queue = require("bull");

const notificationQueue = new Queue("notificatonQueue", {
  redis: {
    host: process.env.NOTIFY_DB_HOST,
    port: process.env.NOTIFY_DB_PORT,
    username: process.env.NOTIFY_DB_USER,
    password: process.env.NOTIFY_DB_PASSWORD,
  },

  limiter: {
    max: 100,
    duration: 1000,
  },
});

module.exports = { notificationQueue };
