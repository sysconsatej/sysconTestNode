const amdin = require("firebase-admin");
const serviceAcc = require("../../services/test-notification-eaa74-firebase-adminsdk-fbsvc-ab22a71ce8.json");
const { executeQuery } = require("../modelSQL/model");

amdin.initializeApp({
  credential: amdin.credential.cert(serviceAcc),
});

const notification = async (req, res) => {
  const fcmToken = req?.body?.data;
  const { clientId, companyId } = req?.body || {};
  const params = { clientId: clientId, companyId: companyId };
  try {
    const result = await executeQuery(
      "exec getNotifications @clientId = @clientId, @companyId = @companyId",
      params,
    );
    const notificationData = result?.recordset?.[0] || {};

    const message = {
      token: fcmToken,
      notification: {
        title: "ArtinShipping",
        body: notificationData?.Notification || "Default notification body",
        imageUrl: "https://picsum.photos/600/300",
      },
      android: {
        priority: "high",
        notification: {},
      },
    };
    await amdin.messaging().send(message);
    return res
      .status(200)
      .json({ success: true, message: "Notification sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { notification };
