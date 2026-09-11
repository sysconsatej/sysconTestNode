// Sends Artin reminders as browser push notifications, so they arrive even
// when every tab of the app is closed. Runs from the cron in index.js when
// ASSISTANT_PUSH_ENABLED=true and VAPID keys are configured.
const webpush = require("web-push");
const model = require("../modelSQL/assistantModel");

// An open tab fires a reminder itself and syncs its deletion within seconds;
// waiting a minute keeps the push from arriving as a second alert.
const GRACE_MS = 60 * 1000;

let vapidConfigured = null;
let running = false;

function configureVapid() {
  if (vapidConfigured !== null) return vapidConfigured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:support@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  vapidConfigured = true;
  return true;
}

function isPushEnabled() {
  return (
    String(process.env.ASSISTANT_PUSH_ENABLED || "").toLowerCase() === "true" &&
    configureVapid()
  );
}

function getPublicKey() {
  return isPushEnabled() ? process.env.VAPID_PUBLIC_KEY : "";
}

function describe(reminder) {
  const hindi = reminder.lang === "hi";
  if (reminder.kind === "timer") {
    return hindi ? "Aapka timer poora ho gaya." : "Your timer is done.";
  }
  const text = String(reminder.text || "").trim();
  return hindi ? `Yaad dilana tha: ${text}` : `Reminder: ${text}`;
}

async function sendDueAssistantReminders() {
  if (running || !isPushEnabled()) return;
  running = true;
  try {
    const due = await model.claimDueReminders(GRACE_MS);
    for (const reminder of due) {
      const subscriptions = await model.subscriptionsForUser(reminder.userId);
      const payload = JSON.stringify({
        title: "Artin",
        body: describe(reminder),
        tag: `artin-${reminder.itemKey}`,
        url: "/",
      });
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.authKey },
              },
              payload,
              { TTL: 60 * 60 },
            );
          } catch (error) {
            // The browser unsubscribed or the subscription expired.
            if (error?.statusCode === 404 || error?.statusCode === 410) {
              await model.deleteSubscriptionByEndpoint(subscription.endpoint);
            } else {
              console.error("[AssistantReminders] push failed", error?.statusCode || error?.message);
            }
          }
        }),
      );
    }
  } catch (error) {
    console.error("[AssistantReminders]", error?.message || error);
  } finally {
    running = false;
  }
}

module.exports = { getPublicKey, isPushEnabled, sendDueAssistantReminders };
