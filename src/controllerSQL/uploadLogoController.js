const { executeStoredProcedure } = require("../modelSQL/model");
const fs = require("fs");

module.exports = {
  logoChange: async (req, res) => {
    const { oldAvatar, clientId, companyId, userId } = req.body;

    try {
      if (!oldAvatar || !clientId || !companyId || !userId) {
        res.status(400).json({
          success: false,
          message: "oldAvatar or companyId or clientId or userId is messing!",
        });
      }

      let uploadedFile = req?.files?.avatar;
      let setProfile;

      if (uploadedFile) {
        const fileName = "/uploads/" + Date.now() + "-" + uploadedFile.name;

        setProfile = {
          logoPath: fileName,
          clientId: clientId,
          companyId: companyId,
          userId: userId,
        };

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
        setProfile = {
          logoPath: oldAvatar,
          clientId: clientId,
          companyId: companyId,
          userId: userId,
        };
      }

      const data = await executeStoredProcedure(
        "CompanyLogoChangeApi",
        setProfile
      );

      if (data[0].success) {
        res
          .status(200)
          .json({
            success: true,
            message: "Company Logo updated successfully!",
            data: setProfile.logoPath,
          });
      } else {
        res.status(400).json({ success: false, message: data[0].message });
      }
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).send({
        success: false,
        message: "Error - " + error.message,
        data: error.message,
      });
    }
  },
  headerAndFooterLogoChange: async (req, res) => {
    const { clientId, userId, branchId, oldHeader, oldFooter } = req.body;

    try {
      if (!oldHeader || !clientId || !oldFooter || !userId || !branchId) {
        res.status(400).json({
          success: false,
          message:
            "oldHeader or oldFooter or clientId or userId or branchId is messing!",
        });
      }

      let uploadedHeader = req?.files?.headerLogo;
      let uploadedFooter = req?.files?.footerLogo;
      let setProfile;

      setProfile = { clientId, branchId, userId };

      if (uploadedHeader) {
        const fileNameHeader =
          "/uploads/" + Date.now() + "-" + uploadedHeader.name;

        setProfile = { ...setProfile, headerPath: fileNameHeader };

        uploadedHeader.mv("." + fileNameHeader, (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          console.log("Image save in directory!");
        });

        const oldAvatarPath = "." + oldHeader;
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
        setProfile = { ...setProfile, headerPath: oldHeader };
      }

      if (uploadedFooter) {
        const fileNameFooter =
          "/uploads/" + Date.now() + "-" + uploadedFooter.name;

        setProfile = { ...setProfile, footerPath: fileNameFooter };

        uploadedFooter.mv("." + fileNameFooter, (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          console.log("Image save in directory!");
        });

        const oldAvatarPath = "." + oldFooter;
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
        setProfile = { ...setProfile, footerPath: oldFooter };
      }

      const resData = await executeStoredProcedure(
        "companyHeaderFooterLogoChangeApi",
        setProfile
      );

      if (resData[0].success) {
        res
          .status(200)
          .json({
            success: true,
            message: "Company Logo updated successfully!",
            data: {
              footer: setProfile.footerPath,
              header: setProfile.headerPath,
            },
          });
      } else {
        res.status(400).json({ success: false, message: resData[0].message });
      }
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
