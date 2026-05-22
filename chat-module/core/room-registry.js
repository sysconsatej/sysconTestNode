'use strict';

class RoomRegistry {
  /**
   * @param {import('socket.io').Server} io
   */
  constructor(io) {
    this._io = io;
  }

  join(roomId, connId) {
    const socket = this._io.sockets.sockets.get(connId);
    if (socket) socket.join(roomId);
  }

  leave(roomId, connId) {
    const socket = this._io.sockets.sockets.get(connId);
    if (socket) socket.leave(roomId);
  }

  // Remove connId from every room — returns room IDs (Socket.IO tracks this natively)
  leaveAll(connId) {
    const socket = this._io.sockets.sockets.get(connId);
    if (!socket) return [];
    const rooms = Array.from(socket.rooms).filter(r => r !== connId);
    rooms.forEach(r => socket.leave(r));
    return rooms;
  }

  members(roomId) {
    const room = this._io.sockets.adapter.rooms.get(roomId);
    return room ? Array.from(room) : [];
  }

  roomsOf(connId) {
    const socket = this._io.sockets.sockets.get(connId);
    if (!socket) return [];
    return Array.from(socket.rooms).filter(r => r !== connId);
  }

  broadcast(roomId, type, payload, excludeConnId = null) {
    if (excludeConnId) {
      this._io.to(roomId).except(excludeConnId).emit(type, payload);
    } else {
      this._io.to(roomId).emit(type, payload);
    }
  }

  sendTo(connId, type, payload) {
    this._io.to(connId).emit(type, payload);
  }
}

module.exports = RoomRegistry;
