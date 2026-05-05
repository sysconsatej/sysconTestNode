const { Novu } = require('@novu/api')

let novu = null;

const initializeAPiKeyNovu = () => {
    const key = process?.env?.NOVU_SECRET_KEY;
    if (!key) {
        console.warn(`[Novu] No NOVU_SECRET_KEY set — notifications disabled.`);
        return;
    }

    novu = new Novu({ secretKey: key });
    console.log('[Novu] ✅ Initialized')
}

const upsertSubscriber = async ({ userId, username, email = null, phone = null }) => {
    if (!novu) return;
    try {
        await novu?.subscribers?.create({
            subscriberId: userId,
            firstName: username,
            email,
            phone,
        })

    } catch (err) {
        console.error('[Novu] upsertSubscriber error:', err.message)
    }

}



const sendMessageNotification = async ({ toUserId, fromUserName, roomId, messagePreview }) => {
    if (!nouv) return
    try {
        await novu.trigger({
            workflowId: 'chat-new-message',       // workflow you create in Novu dashboard
            to: { subscriberId: toUserId },
            payload: {
                senderName: fromUsername,
                roomId,
                messagePreview: messagePreview.slice(0, 100),
                deepLink: `chat://room/${roomId}`,  // Notifee handles this on RN side
            }
        },
        )
        console.log(`[Novu] 📨 Notification sent → ${toUserId}`);


    } catch (err) {
        console.error('[Novu] sendMessageNotification error:', err?.message)
    }
}

const sendMissedMessagesNotification = async ({ toUserId, roomId, count }) => {
    if (!novu) return;
    try {

        await novu.trigger({
            workflowId: 'chat-missed-messages',
            to: { subscriberId: toUserId },
            payload: { roomId, count, deepLink: `chat://room/${roomId}` },
        })
    } catch (err) {
        console.error('[Novu] sendMissedMessagesNotification error:', err.message);

    }
}



module.exports = { initializeAPiKeyNovu, upsertSubscriber, sendMessageNotification, sendMissedMessagesNotification };
