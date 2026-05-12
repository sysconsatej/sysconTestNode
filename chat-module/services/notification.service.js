// notification service
'use strict'

class NotificationService {

    constructor() {
        this._novu = null;
    }


    init() {
        const key = process.env?.NOVU_SECRET_KEY
        if (!key || key === 'your_novu_secret_key_here') {
            console.warn('[Novu] ⚠️  No NOVU_SECRET_KEY set — notifications disabled.');
            return;
        }
        const { Novu } = require('@novu/api')
        this._novu = new Novu({ secretKey: key });
        console.log('[Novu]  Initialized');
    }

    async upsertSubsricber({ userId, username, email = null, phone = null }) {
        if (!this._novu) return
        try {
            await this._novu.subscribers.create({
                subscriberId: usreId, firstName: username, email, phone,
            })
        } catch (err) {
            console.error('[Novu]  upsertSubscriber error:', e?.message);
        }

    }

    async sendMessageNotification({ toUserId, fromUsername, roomId, messagePreview }) {
        if (!this._novu) return;
        try {
            await this._novu.trigger({
                workflowId: "chat-new-message",
                to: { subscriberId: toUserId },
                payload: {
                    senderName: fromUsername,
                    roomId,
                    messagePreview: messagePreview?.slice(0, 100),
                    deepLink: `chat://room/${roomId}`,
                },
            })
            console.log(`[Novu] -> ${toUserId}`)

        } catch (error) {
            console.log("Notificaton Send Messsage Error :", error?.message)
        }
    }

    async sendMissedMessageNotification({ toUserId, roomId, count }) {
        if (!this._novu) return;
        try {
            await this._novu.trigger({
                workflowId: `chat-missed-messages`,
                to: { subscriberId: toUserId },
                payload: { roomId, count, deepLink: `chat://room/${roomId}` }
            })
        } catch (err) {

        }
    }
}

module.exports = NotificationService;