const { notificationQueue } = require("../queues/notifcationQueue");
const admin = require("firebase-admin");
const client = require("../redis/redis_client");
const serviceAcc = require("../../services/test-notification-eaa74-firebase-adminsdk-fbsvc-ab22a71ce8.json");


admin.initializeApp({
  credential: admin.credential.cert(serviceAcc),
});

notificationQueue.process(5, async (job) => {
  const { clientId, title, body } = job.data;

  const userDeviceKey = `user:${clientId}:devices`;
  const deviceIds = await client?.sMembers(userDeviceKey);

  if (!deviceIds?.length) return;

  const deviceData = await Promise.all(
    deviceIds.map((deviceId) => client?.hGetAll(`device:${deviceId}`)),
  );

  const tokens = deviceData?.map((d) => d?.token)?.filter(Boolean);

  if (!tokens?.length) return;

  const message = {
    tokens,
    notification: { title, body },
    android: { priority: "high" },
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  // remove invalid devicetokens

  for (let i = 0; i < response.responses.length; i++) {
    if (!response.responses[i].success) {
      const failedToken = tokens[i];

      for (let j = 0; j < deviceIds?.length; j++) {
        if (deviceData[j]?.token === failedToken) {
          await client?.sRem(userDeviceKey, deviceIds[j]);
          await client?.del(`device:${deviceIds[j]}`);
        }
      }
    }
  }

  return true;
});
