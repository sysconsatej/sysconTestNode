const amdin = require("firebase-admin");
const serviceAcc = require("../../services/test-notification-eaa74-firebase-adminsdk-fbsvc-ab22a71ce8.json");

amdin.initializeApp({
  credential: amdin.credential.cert(serviceAcc),
});

const notification = async (req, res) => {
  const fcmToken = req?.body?.data;
  const title = "Sample test 102";
  const body = "Hello there this is notification from ArtInShipping";
  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
        imageUrl: "https://picsum.photos/600/300",
        
      },
      android: {
        priority: "high",
        notification: {
        
        },
      },
    };

    await amdin.messaging().send(message);
    res.json({ success: true, message: "Notificaton sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { notification };
