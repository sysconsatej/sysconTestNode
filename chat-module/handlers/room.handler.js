'use strict';

const { S } = require("../core/protocol")

class RoomHandler {
    /**
  * @param {import('../core/store')} store
  * @param {import('../core/ws-server')} ws
  * @param {import('../core/room-registry')} rooms
  */
    constructor(store, ws, rooms) {
        this._store = store;
        this._ws = ws;
        this._rooms = rooms;
    }

    onJoinRoom(connId, { roomId, roomName }) {
        const user = this._store.getUserByConn(connId);
        if (!user) {
            this._ws.sendTo(connId, S.ERROR, { message: 'Not Authenticated' })
            return;
        }

        this._rooms.join(roomId, connId);
        this._store.joinRoom(roomId, user?.userId);

        const history = this._store.getMessages(roomId);
        this._ws.sendTo(connId, S.ROOM_HISTORY, { roomId, message: history });

        this._ws.broadCastRoom(roomId, S.USER_JOINED_ROOM, { roomId, userId: user?.userId, username: user?.username }, connId);

        console.log(`[Room] 🚪 ${user.username} joined: ${roomId}`);


    }
}