const { executeStoredProcedure } = require("../modelSQL/model");
const fs = require("fs");

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
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  profileSubmit: async (req, res) => {
    const { avatar, oldAvatar, ...remainingData } = req.body;

    try {
      let uploadedFile = req?.files?.avatar;
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

        const oldAvatarPath = "." + oldAvatar;
        if (fs.existsSync(oldAvatarPath)) {
          console.log("Old file exists, deleting...");
          fs.unlink(oldAvatarPath, (err) => {
            if (err) console.log("Error deleting old file:", err.message);
            else
              console.log("Old file deleted successfully"),
                console.log("oldAvatarPath", oldAvatarPath);
          });
        } else {
          console.log("oldAvatarPath", oldAvatarPath);
          console.log("Old file does not exist!");
        }
      } else {
        setProfile = { profilePhoto: oldAvatar, ...remainingData };
      }

      const formattedObj = Object.fromEntries(
        Object.entries(setProfile).map(([key, value]) => [
          key,
          value === "null" ? null : isNaN(value) ? value : Number(value),
        ])
      );

      await executeStoredProcedure("profileSubmitApi", formattedObj);
      res.json({
        success: true,
        message: "Profile updated successfully!",
        data: formattedObj,
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
  themeChange: async (req, res) => {
    try {
      if (!req.body.themeId) {
        res.status(400).send({
          success: false,
          message: "themeId is missing!",
        });
      }
      const parameters = { themeId: req.body.themeId };
      let themeData = await executeStoredProcedure("themeApi", parameters);

      if (themeData) {
        res.send({
          success: true,
          message: "Data fetch Successfully",
          data: themeData,
        });
      }
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
};
