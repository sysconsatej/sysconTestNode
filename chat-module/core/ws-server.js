'use strict'
class WSServer {
    /**
   * @param {import('socket.io').Server} io
   * @param {import('./Store')} store
   * @param {import('./RoomRegistry')} rooms
   */

    constructor(io, store, rooms) {
        this._io = io;
        this._store = store;
        this._rooms = rooms;
    }

    sendTo(connId, type, payload = {}) {
        this._io.to(connId).emit(type, payload);
    }

    broadCastRoom(roomId, type, payload = {}, excludeConnId = null) {
        if (excludeConnId) {
            this._io.to(roomId).except(excludeConnId).emit(type, payload);
        } else {
            this._io.to(roomId).emit(type, payload);
        }
    }

    broadcastAll(type, payload = {}, excludeConnId = null) {
        if (excludeConnId) {
            this._io.except(excludeConnId).emit(type, payload);
        } else {
            this._io.emit(type, payload);
        }
    }

    sendToUser(userId, type, payload = {}) {
        const connId = this._store.getConnIdForUser(userId);
        if (connId) this.sendTo(connId, type, payload);
    }

    get connectionCount() {
        return this._io.sockets.sockets.size;
    }
}

module.exports = WSServer;