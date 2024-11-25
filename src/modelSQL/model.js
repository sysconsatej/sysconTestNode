const { connectToSql } = require("../config/sqlConfig");

module.exports = {
    executeQuery: async (query, data) => {
        try {
            const pool = await connectToSql();
            const request = pool.request();
            for (const [key, value] of Object.entries(data)) {
                request.input(key, value);
            };
            const result = await request.query(query);
            return result; // Return the result set
        } catch (error) {
            console.error('Error inserting data:', error);
            throw error;
        }
    },
    executeStoredProcedure: async (procedureName, data) => {
        try {
            const pool = await connectToSql();
            const request = pool.request();
            for (const [key, value] of Object.entries(data)) {
                request.input(key, value);
            };
            const result = await request.execute(procedureName);;
            return result; // Return the result set
        } catch (error) {
            console.error('Error inserting data:', error);
            throw error;
        }
    }
}