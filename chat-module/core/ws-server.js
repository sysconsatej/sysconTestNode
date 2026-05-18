// WSServer.js — Socket.IO adapter
// Exposes the exact same interface as the raw-ws version.
// All handler classes call this and never touch Socket.IO directly.
'use strict';

class WSServer {
  /**
   * @param {import('socket.io').Server} io
   * @param {import('./store')} store
   * @param {import('./room-registry')} rooms
   */
  constructor(io, store, rooms) {
    this._io    = io;
    this._store = store;
    this._rooms = rooms;
  }

  // ── Send to a single socket by connId ────────────────────────────────────────
  sendTo(connId, type, payload = {}) {
    this._io.to(connId).emit(type, payload);
  }

  // ── Broadcast to a room, optionally excluding one connId ─────────────────────
  broadcastRoom(roomId, type, payload = {}, excludeConnId = null) {
    if (excludeConnId) {
      this._io.to(roomId).except(excludeConnId).emit(type, payload);
    } else {
      this._io.to(roomId).emit(type, payload);
    }
  }

  // ── Broadcast to every connected socket ──────────────────────────────────────
  broadcastAll(type, payload = {}, excludeConnId = null) {
    if (excludeConnId) {
      this._io.except(excludeConnId).emit(type, payload);
    } else {
      this._io.emit(type, payload);
    }
  }

  // ── Send to a userId (looks up connId from store) ────────────────────────────
  sendToUser(userId, type, payload = {}) {
    const connId = this._store.getConnIdForUser(userId);
    if (connId) this.sendTo(connId, type, payload);
  }

  get connectionCount() {
    return this._io.sockets.sockets.size;
  }
}

module.exports = WSServer;
