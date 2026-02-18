require("dotenv").config();
const { notificationQueue } = require("../queues/notifcationQueue");
const admin = require("firebase-admin");
const client = require("../redis/redis_notify_client");
const serviceAcc = require("../../services/test-notification-eaa74-firebase-adminsdk-fbsvc-ab22a71ce8.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAcc),
});

notificationQueue.process(5, async (job) => {
  const { clientId, title, body } = job.data;

  const userDeviceKey = `user:${clientId}:devices`;
  const deviceIds = await client?.smembers(userDeviceKey);

  if (!deviceIds?.length) {
    return;
  }

  const deviceData = await Promise.all(
    deviceIds.map((deviceId) => client?.hgetall(`device:${deviceId}`)),
  );

  const tokens = deviceData?.map((d) => d?.fcmToken)?.filter(Boolean);

  if (!tokens?.length) {
    return;
  }

  const message = {
    tokens,
    notification: { title, body },
    data: { title, body },
    android: { priority: "high" },
  };

  console.log(`[Worker] Sending notification:`, message);

  try {
    const response = await admin.messaging().sendEachForMulticast(message);

    // remove invalid tokens
    for (let i = 0; i < response.responses.length; i++) {
      if (!response.responses[i].success) {
        const failedToken = tokens[i];
        console.log(
          `[Worker] Failed token: ${failedToken}, reason:`,
          response.responses[i].error,
        );

        for (let j = 0; j < deviceIds?.length; j++) {
          if (deviceData[j]?.fcmToken === failedToken) {
            await client?.srem(userDeviceKey, deviceIds[j]);
            await client?.del(`device:${deviceIds[j]}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(
      `[Worker] Error sending notifications for clientId ${clientId}:`,
      err,
    );
  }

  return true;
});
