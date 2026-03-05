const redis = require("ioredis");

const client_notify = new redis({
  host: process.env.NOTIFY_DB_HOST,
  port: process.env.NOTIFY_DB_PORT,
  username: process.env.NOTIFY_DB_USER,
  password: process.env.NOTIFY_DB_PASSWORD,
});
client_notify.on("connect", () => {
  console.log("Connected to Notify Server");
});

client_notify.on("error", (err) => {
  console.error("Notify server connection error:", err);
});

module.exports = client_notify;
