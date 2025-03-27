const { connectToSql } = require("../config/sqlConfig");

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
};
