// Import the Mongoose module for MongoDB connection
const { check } = require("express-validator");
const mongoose = require("../../config/MongoConnection");
const sql = require("mssql");
const { executeStoredProcedure } = require("../../modelSQL/model");
const { connectToSql } = require("../../config/sqlConfig");

// Export the module
module.exports = {
  // Function to check for existing data
  checkExistingData: async (req, res) => {
    // Extract table name, JSON data, and fields to check from request body
    const tableName = req.body.tableName;
    const jsonData = req.body.jsonData;
    const checkFieldsForExistingData = req.body.checkFieldsForExistingData;
    try {
      // Access the MongoDB database and collection based on the provided table name
      const collection = mongoose.connection.collection(tableName); // Use the connection established by mongoose

      // Retrieve existing data from the collection where status is 1 (active)
      const existingData = await collection.find({ status: 1 }).toArray(); // Only consider data with status 1
      // Create a copy of existing data for comparison
      const existingValues = existingData.map((item) => ({ ...item })); // Copy existing data
      // Initialize array to store existing data found in the database
      const existingDataInDatabase = [];

      // Loop through each JSON object provided in the request
      for (const [index, obj] of jsonData.entries()) {
        // Loop through each key in the JSON object
        for (const key in obj) {
          // Check if the key is included in the fields to check
          if (
            Object.hasOwnProperty.call(obj, key) &&
            checkFieldsForExistingData.includes(key)
          ) {
            // Check if any existing data matches the current key-value pair
            if (existingValues.some((item) => item[key] === obj[key])) {
              // If a match is found, add details to the existing data array
              existingDataInDatabase.push({
                index: index + 1,
                field: key,
                value: obj[key],
              });
            }
          }
        }
      }

      // Return the existing data found in the database
      res.status(200).json({
        success: true,
        message: "List of Data Already Exist in Database",
        data: existingDataInDatabase,
      });
    } catch (error) {
      // Handle any errors that occur during the database operation
      console.error("Error checking data in the MongoDB database:", error);
      // Send an error response with status code 500
      res.status(500).json({
        success: false,
        message: "Error checking data in the MongoDB database",
        error: error.message,
      });
    }
  },
  // Function to check fieldNames
  checkFieldName: async (req, res) => {
    const tableName = req.body.tableName;
    const jsonData = req.body.jsonData;

    try {
      // Access the MongoDB database and collection based on the provided table name
      const collection = mongoose.connection.collection(tableName); // Use the connection established by mongoose

      // Get the fields present in the MongoDB collection
      const collectionFields = await collection.findOne({}); // Get a document to retrieve its keys (fields)
      const fieldNamesInDatabase = Object.keys(collectionFields);

      // Initialize array to store incorrect field names
      const incorrectFieldNames = [];

      // Loop through each JSON object provided in the request
      for (const obj of jsonData) {
        // Loop through each key in the JSON object
        for (const key in obj) {
          // Check if the key is not present in the list of field names in the database collection
          if (!fieldNamesInDatabase.includes(key)) {
            // If key is not found, add it to the list of incorrect field names
            incorrectFieldNames.push(key);
          }
        }
      }

      // Return the list of incorrect field names
      res.status(200).json({
        success: true,
        message: "List Incorrect Field Names",
        data: incorrectFieldNames,
      });
    } catch (error) {
      // Handle any errors that occur during the database operation
      console.error("Error checking data in the MongoDB database:", error);
      // Send an error response with status code 500
      res.status(500).json({
        success: false,
        message: "Error checking data in the MongoDB database",
        error: error.message,
      });
    }
  },
  // Function to check Size of the values with master_schema
  checkValueSize: async (req, res) => {
    const tableName = req.body.tableName;
    const jsonData = req.body.jsonData;

    try {
      // Access the MongoDB database and collection for master_schema
      const masterSchemaCollection =
        mongoose.connection.collection("master_schema"); // Use the connection established by mongoose

      // Find the master schema document for the given table name
      const masterSchemaDocument = await masterSchemaCollection.findOne({
        tableName,
      });

      if (!masterSchemaDocument) {
        return res.status(404).json({
          success: false,
          message: `Master schema not found for table ${tableName}`,
        });
      }

      // Extract field definitions from the master schema
      const fieldDefinitions = masterSchemaDocument.fields.reduce(
        (acc, field) => {
          acc[field.fieldname] = { size: field.size, index: field.index }; // Create a dictionary of fieldname, size, and index
          return acc;
        },
        {}
      );

      // Initialize array to store fields with oversized values
      const oversizedFields = [];

      // Iterate over JSON data
      for (const [index, obj] of jsonData.entries()) {
        // Check size of each field value
        for (const key in obj) {
          if (Object.hasOwnProperty.call(obj, key)) {
            const fieldValue = obj[key];
            const fieldInfo = fieldDefinitions[key];
            if (fieldInfo && fieldValue.length > fieldInfo.size) {
              // If size of value exceeds the defined size, add it to oversizedFields along with the index
              oversizedFields.push({
                index: index + 1,
                field: key,
                size: fieldInfo.size,
              });
            }
          }
        }
      }

      // Return the list of fields with oversized values
      res.status(200).json({
        success: true,
        message:
          "List of Field's having size of values more than the size mentioned in the schema",
        data: oversizedFields,
      });
    } catch (error) {
      // Handle any errors that occur during the database operation
      console.error(
        "Error checking value size in the MongoDB database:",
        error
      );
      // Send an error response with status code 500
      res.status(500).json({
        success: false,
        message: "Error checking value size in the MongoDB database",
        error: error.message,
      });
    }
  },
  insertExcelDataA: async (req, res) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      // Ensure req.body.json is a string
      const payload =
        typeof req.body.json === "string"
          ? req.body.json
          : JSON.stringify(req.body.json);

      // Only one input param (matches your SP signature)
      request.input("json", sql.NVarChar(sql.MAX), payload);

      // Execute the SP
      const result = await request.execute("insertExcelData");

      // result.rowsAffected is an array of row‑counts per statement
      // e.g. [1,1,1] if you did three INSERTs, so sum them:
      const rowsInserted = Array.isArray(result.rowsAffected)
        ? result.rowsAffected.reduce((sum, n) => sum + n, 0)
        : 0;

      res.json({
        success: rowsInserted > 0,
        message:
          rowsInserted > 0 ? "Data Inserted Successfully" : "No rows affected",
        rowsAffected: rowsInserted,
      });
    } catch (err) {
      console.error("insertExcelData error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to insert data",
        error: err.message,
      });
    }
  },
  insertExcelData: async (req, res) => {
    try {
      const jsonData = req.body;

      // Convert the Record object to a JSON string
      const formattedRecord = JSON.stringify(jsonData);

      // Connect to the database
      const pool = await connectToSql();
      let RowsAffected = 1;
      // Prepare the stored procedure request
      const request = pool.request();
      request.input("json", sql.NVarChar(sql.MAX), formattedRecord);
      request.output("RowsAffected", sql.Int, RowsAffected); // Add output parameter
      // Execute the stored procedure
      const result = await request.execute("insertExcelData");

      // Check the RowsAffected output parameter
      const rowsAffected = result.output.RowsAffected;

      // Respond to the client
      if (rowsAffected > 0) {
        res.send({
          success: true,
          message: "Data Inserted Successfully",
          rowsAffected: rowsAffected,
        });
      } else {
        res.send({
          success: false,
          message: "No rows affected",
          rowsAffected: rowsAffected,
        });
      }
    } catch (error) {
      console.error("Error executing stored procedure:", error);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        error: error.message,
      });
    }
  },
};
