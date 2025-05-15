const { AES } = require("crypto-js");

module.exports = {
  decryptAndEncrypt: async (req, res) => {
    const { data } = req.body;
    try {
      return res.status(200).json({
        success: true,
        message: "data encrypt successfully!",
        data: AES.encrypt(data, process.env.AES_TOKEN || "").toString(),
      });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Something went wrong",
        data: error.message,
      });
    }
  },
};
