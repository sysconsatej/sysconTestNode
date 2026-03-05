// const { executeQuery } = require("../modelSQL/model");
// const { notificationQueue } = require("../queues/notifcationQueue");
// const client = require("../redis/redis_notify_client");

// const notification = async (req, res) => {
//   const { clientId, companyId } = req?.body || {};
//   const params = { clientId: clientId, companyId: companyId };
//   try {
//     const result = await executeQuery(
//       "exec getNotifications @clientId = @clientId, @companyId = @companyId",
//       params,
//     );
//     const notificationData = result?.recordset?.[0] || {};

//     await notificationQueue.add(
//       {
//         clientId: clientId,
//         title: "ArtinShipping",
//         body: notificationData?.Notification || "Default Body",
//       },
//       {
//         attempts: 3,
//         backoff: 5000,
//         removeOnComplete: true,
//         removeOnFail: false,
//       },
//     );

//     return res.send({
//       success: true,
//       message: "Notification queues successfully",
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// const saveDeviceToken = async (req, res) => {
//   try {
//     const { clientId, deviceId, fcmToken, os, appVersion } = req.body;
//     console.log("Received device token data:", {
//       clientId,
//       deviceId,
//       fcmToken,
//       os,
//       appVersion,
//     });

//     if (!clientId || !deviceId || !fcmToken) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Missing required fields" });
//     }

//     const userDeviceKey = `user:${clientId}:devices`;
//     const deviceKey = `device:${deviceId}`;

//     // Add device to user's device set
//     await client.sadd(userDeviceKey, deviceId);

//     // Store device metadata
//     await client.hset(deviceKey, {
//       os: os || "unknown",
//       appVersion: appVersion || "unknown",
//       lastSeen: Date.now(),
//       fcmTokenUpdatedAt: Date.now(),
//       fcmTokenCreatedAt: Date.now(),
//       fcmToken: `${fcmToken}`,
//     });

//     return res.json({ success: true, message: "Device token saved" });
//   } catch (err) {
//     console.error("Error saving device token:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// module.exports = { notification, saveDeviceToken };
