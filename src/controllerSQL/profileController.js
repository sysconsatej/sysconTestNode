const { executeStoredProcedure } = require("../modelSQL/model");

module.exports = {
  dropdowns: async (req, res) => {
    try {
      let { data } = await executeStoredProcedure("profileAllDropdowns", {companyId:req.body.companyId});

      if (data) {
        res.send({
          success: true,
          message: "Data fetch Successfully",
          data: data,
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "something went wrong",
        data: error.message,
      });
    }
  },
};
