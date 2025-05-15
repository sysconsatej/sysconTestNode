const { AES, enc } = require("crypto-js");

module.exports = {
  decryptAndEncrypt: async (req, res) => {
    const { data, type } = req.body;
    try {
      if ((type === "encrypt")) {
        return res.status(200).json({
          success: true,
          message: "data encrypt successfully!",
          data: AES.encrypt(data, process.env.AES_TOKEN || "").toString(),
        });
      }

      return res.status(200).json({
        success: true,
        message: "data decrypt successfully!",
        data: AES.decrypt(data, process.env.AES_TOKEN || "").toString(enc.Utf8),
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
