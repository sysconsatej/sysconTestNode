const { executeQuery, executeStoredProcedure } = require("../modelSQL/model");
const sql = require("mssql");
const { connectToSql } = require("../config/sqlConfig");
const { concat } = require("lodash");

const ensureJsonString = (val) => {
  if (val == null) return null; // allow NULL to SQL if your SP supports it
  if (typeof val === "string") return val; // already a JSON string
  return JSON.stringify(val); // object -> string
};

const safeInt = (v) => (v == null || v === "" ? null : Number(v));

// Optional: parse MSSQL JSON column into plain objects
const unwrapMssqlJson = (recordset) => {
  if (!Array.isArray(recordset)) return [];
  const KEY = "JSON_F52E2B61-18A1-11d1-B105-00805F49916B";
  return recordset.map((row) => {
    if (row && Object.prototype.hasOwnProperty.call(row, KEY)) {
      try {
        return JSON.parse(row[KEY]); // usually { data: [...] } etc.
      } catch {
        // if parsing fails, just return the original row
        return row;
      }
    }
    return row;
  });
};
// Optional: parse MSSQL JSON column into plain objects
module.exports = {
  insertUpdateBlData: async (req, res) => {
    try {
      const { jsonData, clientId, id } = req.body;

      // Guard: clientId is mandatory (per your earlier note)
      if (
        clientId == null ||
        clientId === "" ||
        (Number.isNaN(Number(clientId)) && jsonData == null)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "clientId is required and must be a number and jsonData is required",
        });
      }

      const pool = await connectToSql();
      const request = pool.request();

      const jsonDataStr = ensureJsonString(jsonData);

      const result = await request
        .input("jsonData", sql.NVarChar(sql.MAX), jsonDataStr)
        .input("clientId", sql.Int, Number(clientId))
        .input("id", sql.Int, safeInt(id))
        .execute("insertUpdateBlData");

      // Prefer .recordset; fallback to first in .recordsets
      const raw = result?.recordset ?? result?.recordsets?.[0] ?? [];
      const parsed = unwrapMssqlJson(raw);

      res.send({
        success: true,
        message: "Data Fetched Successfully",
        data: parsed.length ? parsed[0]?.data : raw,
        count: (parsed.length ? parsed : raw).length,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
        error: error?.message || String(error),
      });
    }
  },
};
