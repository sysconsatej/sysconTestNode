// handlers/RoomHandler.js

'use strict';

const { S } = require('../core/protocol');

class RoomHandler {
  constructor(store, ws, rooms) {
    this._store = store;
    this._ws    = ws;
    this._rooms = rooms;
  }

  // frame type: 'join_room'
  // payload: { roomId, roomName? }
  onJoinRoom(connId, { roomId, roomName }) {
    const user = this._store.getUserByConn(connId);
    if (!user) { this._ws.sendTo(connId, S.ERROR, { message: 'Not authenticated' }); return; }

    this._rooms.join(roomId, connId);
    this._store.joinRoom(roomId, user.userId);

    const history = this._store.getMessages(roomId);
    this._ws.sendTo(connId, S.ROOM_HISTORY, { roomId, messages: history });

    // Notify others in the room
    this._ws.broadcastRoom(roomId, S.USER_JOINED_ROOM, {
      roomId, userId: user.userId, username: user.username,
    }, connId);

    console.log(`[Room] 🚪 ${user.username} joined: ${roomId}`);
  }

  // frame type: 'leave_room'
  // payload: { roomId }
  onLeaveRoom(connId, { roomId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;

    this._rooms.leave(roomId, connId);
    this._store.leaveRoom(roomId, user.userId);

    this._ws.broadcastRoom(roomId, S.USER_LEFT_ROOM, {
      roomId, userId: user.userId, username: user.username,
    });
  }
}

module.exports = RoomHandler;
