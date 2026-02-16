const Queue = require("bull");

const notificationQueue = new Queue("notificatonQueue", {
  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASS,
  },

  limiter: {
    max: 100,
    duration: 1000,
  },
});

module.exports = { notificationQueue };
