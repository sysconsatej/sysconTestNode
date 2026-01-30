// sql.config.js
const sql = require("mssql");

const sqlConfig = {
  user: process.env.SQL_DB_USER,
  password: process.env.SQL_DB_PASSWORD,
  server: process.env.SQL_SERVER_IP,
  port: Number(process.env.SQL_DB_PORT || 15999),
  database: process.env.SQLDB,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
  },
  // important timeouts
  connectionTimeout: 30000, // 30s connect timeout (default was 15s in your error)
  requestTimeout: 120000,   // 2 min for slow SPs
};

let poolPromise = null;

async function connectToSql() {
  try {
    if (!poolPromise) {
      const pool = new sql.ConnectionPool(sqlConfig);

      poolPromise = pool.connect().then((p) => {
        console.log("✅ Connected to MS SQL successfully.");
        // if pool errors, allow reconnect next time
        p.on("error", (err) => {
          console.error("❌ MSSQL Pool Error:", err);
          poolPromise = null;
        });
        return p;
      });
    }

    return await poolPromise;
  } catch (err) {
    poolPromise = null; // reset so next request can retry
    console.error("❌ Error connecting to MS SQL:", err);
    throw err;
  }
}

module.exports = { connectToSql, sql };
