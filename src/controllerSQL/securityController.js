const { AES } = require("crypto-js");

module.exports = {
  encrypt: async (req, res) => {
    const { encryptedStr } = req.body;
    if (!encryptedStr) {
      return res.status(400).json({
        success: false,
        message: "encryptedStr variable is undefine!",
      });
    }
    try {
      return res.status(200).json({
        success: true,
        message: "data encrypt successfully!",
        data: AES.encrypt(encryptedStr, process.env.AES_TOKEN || "").toString(),
      });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
