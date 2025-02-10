const { executeStoredProcedure } = require("../modelSQL/model");
const fs = require("fs");
const path = require("path");

module.exports = {
  dropdowns: async (req, res) => {
    try {
      let { data } = await executeStoredProcedure("profileAllDropdowns", {
        companyId: req.body.companyId,
      });

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
  profileSubmit: async (req, res) => {
    const { avatar, oldAvatar, ...remainingData } = req.body;

    try {
      let uploadedFile = req.files.avatar;
      let setProfile;

      if (uploadedFile) {
        const fileName = "/uploads/" + Date.now() + "-" + uploadedFile.name;

        setProfile = { profilePhoto: fileName, ...remainingData };

        uploadedFile.mv("." + fileName, (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          console.log("Image save in directory!");
        });

        //const oldAvatarPath = path.join(__dirname, oldAvatar);
        // if (fs.existsSync(oldAvatarPath)) {
        //   console.log("✅ Old file exists, deleting...");
        //   fs.unlink(oldAvatarPath, (err) => {
        //     if (err) console.log("❌ Error deleting old file:", err.message);
        //     else console.log("✅ Old file deleted successfully");
        //   });
        // } else {
        //   console.log("❌ Old file does not exist!");
        // }
      } else {
        setProfile = { profilePhoto: oldAvatar, ...remainingData };
      }

      await executeStoredProcedure("profileSubmitApi", setProfile);
      res.json({ success: true, message: "Profile updated successfully!" });
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
