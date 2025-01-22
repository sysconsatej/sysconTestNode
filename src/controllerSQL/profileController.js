const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  dropdowns: async () => {
    try {
      let { data, error } = await executeStoredProcedure("profileAllDropdowns");

      if (data) {
        res.send({
          success: true,
          message: "Data fetch Successfully",
          data: data,
        });
      } else {
        res.status(400).send({
          success: false,
          message: "Data not found!",
          error: error,
        });
      }
    } catch (error) {
      errorLogger(error, req);
      res.status(500).send({
        success: false,
        message: "something went wrong",
        data: error.message,
      });
    }
  },
};
