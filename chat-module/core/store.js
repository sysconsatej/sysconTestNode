// Store.js — in-memory state as a class (drop-in for store.js)

'use strict';

const { v4: uuidv4 } = require('uuid');

class Store {
  constructor() {
    // connId → { userId, username, avatar, onlineAt }
    this._conns = new Map();

    // userId → connId  (latest connection for this user)
    this._userConns = new Map();

    // roomId → { id, name, members: Set<userId>, createdAt }
    this._rooms = new Map();

    // roomId → Message[]
    this._messages = new Map();

    // roomId → Set<userId>
    this._typing = new Map();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  static getDmRoomId(userIdA, userIdB) {
    return 'dm:' + [userIdA, userIdB].sort().join(':');
  }

  // ── Connection / presence ─────────────────────────────────────────────────────

  registerConn(connId, { userId, username, avatar = null }) {
    this._conns.set(connId, { userId, username, avatar, onlineAt: Date.now() });
    this._userConns.set(userId, connId);
  }

  removeConn(connId) {
    const user = this._conns.get(connId);
    if (user) {
      if (this._userConns.get(user.userId) === connId) {
        this._userConns.delete(user.userId);
      }
      this._conns.delete(connId);
    }
    return user || null;
  }

  getUserByConn(connId) {
    return this._conns.get(connId) || null;
  }

  getUserById(userId) {
    const connId = this._userConns.get(userId);
    return connId ? (this._conns.get(connId) || null) : null;
  }

  getConnIdForUser(userId) {
    return this._userConns.get(userId) || null;
  }

  isOnline(userId) {
    return this._userConns.has(userId);
  }

  getOnlineUsers() {
    const result = [];
    this._conns.forEach((user, connId) => result.push({ ...user, connId }));
    return result;
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────────

  getOrCreateRoom(roomId, name = null) {
    if (!this._rooms.has(roomId)) {
      this._rooms.set(roomId, {
        id: roomId,
        name: name || roomId,
        members: new Set(),
        createdAt: Date.now(),
      });
      this._messages.set(roomId, []);
      this._typing.set(roomId, new Set());
    }
    return this._rooms.get(roomId);
  }

  joinRoom(roomId, userId) {
    const room = this.getOrCreateRoom(roomId);
    room.members.add(userId);
    return room;
  }

  leaveRoom(roomId, userId) {
    const room = this._rooms.get(roomId);
    if (room) {
      room.members.delete(userId);
      this._typing.get(roomId)?.delete(userId);
    }
  }

  getRoomMembers(roomId) {
    return Array.from(this._rooms.get(roomId)?.members || []);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────

  addMessage(roomId, { senderId, senderName, content, type = 'text', replyTo = null }) {
    const messages = this._messages.get(roomId);
    if (!messages) return null;

    const msg = {
      id:          uuidv4(),
      roomId,
      senderId,
      senderName,
      content,
      type,
      replyTo,
      status:      'sent',
      createdAt:   Date.now(),
      deliveredTo: [],
      readBy:      [],
    };

    messages.push(msg);
    return msg;
  }

  updateMessageStatus(roomId, messageId, userId, status) {
    const msg = (this._messages.get(roomId) || []).find(m => m.id === messageId);
    if (!msg) return null;

    if (status === 'delivered' && !msg.deliveredTo.includes(userId)) {
      msg.deliveredTo.push(userId);
      if (msg.status === 'sent') msg.status = 'delivered';
    }

    if (status === 'read' && !msg.readBy.includes(userId)) {
      msg.readBy.push(userId);
      msg.deliveredTo = [...new Set([...msg.deliveredTo, userId])];
      msg.status = 'read';
    }

    return msg;
  }

  getMessages(roomId, limit = 50) {
    return (this._messages.get(roomId) || []).slice(-limit);
  }

  // ── Typing ────────────────────────────────────────────────────────────────────

  setTyping(roomId, userId, isTyping) {
    if (!this._typing.has(roomId)) this._typing.set(roomId, new Set());
    const set = this._typing.get(roomId);
    isTyping ? set.add(userId) : set.delete(userId);
    return Array.from(set);
  }

  getTypingUsers(roomId) {
    return Array.from(this._typing.get(roomId) || []);
  }
}

module.exports = Store;
