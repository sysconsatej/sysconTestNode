const sql = require("mssql");

const sqlConfig = {
  user: "sa",
  password: "sysuser@2804",
  server: "156.67.111.117",
  port: 15999, // Specify the custom port here
  database: "syscon",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool;

const connectToSql = async () => {
  try {
    if (!pool) {
      pool = await sql.connect(sqlConfig);
      console.log("Connected to MS SQL successfully.".green);
    }
    return pool;
  } catch (err) {
    console.error("Error connecting to MS SQL:".green, err);
    throw err;
  }
};

module.exports = { connectToSql, sql };
