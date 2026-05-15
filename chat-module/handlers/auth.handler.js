'use strict';

const { S } = require("../core/protocol");


class AuthHandler {
    /**
   * @param {import('../core/store')} store
   * @param {import('../core/ws-server')} ws
   * @param {import('../services/notification.service')} notifs
   */
    constructor(store, ws, notifs) {
        this._store = store;
        this._ws = ws
        this._notifis = notifs;
    }

    onAuth(connId, { userId, username, avatar }) {
        if (!userId || !username) {
            this._ws.sendTo(connId, S.AUTH_ERROR, { message: "Auth requires username and userId" });
            return;
        }

        this._store.registerConnection(connId, { userId, username, avatar });
        this._notifis.upsertSubsricber({ userId, username });


        this._ws.sendTo(connId, S.AUTH_SUCCESS, {
            userId,
            username,
            onlineUsers: this._store.getOnlineUsers().map(u => ({
                userId: u?.userId,
                username: u?.username,
                avatar: u?.avatar,
            }))
        })

        this._ws.broadcastAll(S.USER_ONLINE, { userId, username, avatar }, connId);

        console.log(`[Auth] 👤 ${username} (${userId}) connected via ${connId}`);

    }

    onPing(connId) {
        this._ws.sendTo(connId, S.PONG, { ts: Date.now() })
    }
}

module.exports = AuthHandler;