const { connectToSql } = require("../config/sqlConfig");
const sql = require("mssql");

module.exports = {
  executeQuery: async (query, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.query(query);
      return result; // Return the result set
    } catch (error) {
      console.error("Error inserting data:", error);
      throw error;
    }
  },
  executeStoredProcedure: async (procedureName, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);

      if (result.recordsets.length == 0) {
        return [];
      }
      return (
        JSON.parse(
          result.recordset[0]?.["JSON_F52E2B61-18A1-11d1-B105-00805F49916B"]
        ) || []
      ); // Return the result set
    } catch (error) {
      console.error("Error inserting data:", error);
      return [];
    }
  },
  executeStoredProcedureXML: async (procedureName, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);

      if (result.recordsets.length == 0) {
        return [];
      }
      return result.recordset[0] || [];
    } catch (error) {
      console.error("Error inserting data:", error);
      return [];
    }
  },
  executeStoredProcedureToSendEmail: async (procedureName, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);

      if (result.recordsets.length == 0) {
        return [];
      }
      return (
        JSON.parse(
          result.recordsets[1]?.[0]?.[
            "JSON_F52E2B61-18A1-11d1-B105-00805F49916B"
          ]
        ) || []
      ); // Return the result set
    } catch (error) {
      console.error("Error inserting data:", error);
      return [];
    }
  },
  execSpWithJsonParam: async (
    procedureName,
    jsonPayload,
    paramName = "filterCondition"
  ) => {
    if (!procedureName || typeof procedureName !== "string") {
      throw new Error("procedureName must be a non-empty string");
    }

    // 1) Normalize to a JSON string
    const payloadString =
      typeof jsonPayload === "string"
        ? jsonPayload
        : JSON.stringify(jsonPayload);

    try {
      const pool = await connectToSql();
      const request = pool.request();

      request.input(paramName, sql.NVarChar(sql.MAX), payloadString);

      // 3) Execute
      const result = await request.execute(procedureName);

      // 4) No rows → empty array
      if (!result.recordsets?.length) {
        return [];
      }

      // 5) The FOR JSON output column has that GUID name
      const rawJson =
        result.recordset[0]?.["JSON_F52E2B61-18A1-11d1-B105-00805F49916B"];

      return rawJson ? JSON.parse(rawJson) : [];
    } catch (err) {
      console.error(`Error executing ${procedureName}:`, err);
      return [];
    }
  },
  executeNonJSONStoredProcedure: async (procedureName, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);
      return result; // Return the result set
    } catch (error) {
      if (error.originalError) {
        console.error("SQL Error Details:");
        console.error("Message:", error.originalError.message);
        console.error("Procedure Name:", procedureName);
        console.error("Data:", data);
      } else {
        console.error("Error Details:", error.message);
      }
      console.error("Error inserting data:", error);
      throw error;
    }
  },
  executeMultipleStoredProcedure: async (procedureName, data) => {
    try {
      const pool = await connectToSql();
      const request = pool.request();
      for (const [key, value] of Object.entries(data)) {
        request.input(key, value);
      }
      const result = await request.execute(procedureName);

      // Initialize an empty array to hold each JSON-parsed recordset
      const allData = [];

      // Iterate over each recordset and parse its JSON content
      result.recordsets.forEach((recordset) => {
        // Ensure the recordset is not empty and has the expected JSON data column
        if (
          recordset.length > 0 &&
          recordset[0] &&
          Object.keys(recordset[0]).length > 0
        ) {
          // Parse each key in the recordset's first row (assuming each key is a JSON string)
          Object.keys(recordset[0]).forEach((key) => {
            const parsedData = JSON.parse(recordset[0][key]);
            allData.push(parsedData);
          });
        }
      });

      return allData; // Return the array of all parsed JSON objects
    } catch (error) {
      console.error("Error executing stored procedure:", error);
      throw error;
    }
  },
  executeNonQueryStoredProcedure: async (spName, params = {}) => {
    try {
      // 1) get a live pool
      const pool = await connectToSql();

      // 2) build the request & bundle all params into @json
      const req = pool.request();
      req.input("json", sql.NVarChar(sql.MAX), JSON.stringify(params));

      // 3) execute
      const result = await req.execute(spName);

      // 4) no rows? return empty array
      if (result.recordsets.length === 0) {
        return [];
      }

      // 5) parse the single JSON column from the first row
      const jsonCol = "JSON_F52E2B61-18A1-11d1-B105-00805F49916B";
      const raw = result.recordset[0]?.[jsonCol] || result.recordset?.length;
      return JSON.parse(raw) || [];
    } catch (error) {
      console.error(`Error executing ${spName}:`, error);
      throw error;
    }
  },

  executeSpTransaction: async (sps) => {
    let pool, transaction;
    try {
      pool = await connectToSql();
      transaction = new sql.Transaction(pool);
      await transaction.begin();

      let prevOutput = {};
      for (const sp of sps) {
        const request = new sql.Request(transaction);

        // Prepare inputs: either direct params or mapped from previous output
        let params = sp.params || {};
        if (sp.mapParams && typeof sp.mapParams === "function") {
          params = sp.mapParams(prevOutput) || {};
        }
        for (const [key, value] of Object.entries(params)) {
          request.input(key, value);
        }

        // Execute the SP
        prevOutput = await request.execute(sp.name);
        // prevOutput: has recordset, output, returnValue, etc.
      }

      await transaction.commit();
      return prevOutput; // output of the last SP
    } catch (err) {
      if (transaction) await transaction.rollback();
      throw err;
    } finally {
      if (pool) await pool.close();
    }
  },
};
