// handlers/MessageHandler.js

'use strict';

const { S } = require('../core/protocol');
const Store = require('../core/store');

class MessageHandler {
  constructor(store, ws, rooms, notifs) {
    this._store = store;
    this._ws = ws;
    this._rooms = rooms;
    this._notifs = notifs;

    // typing debounce timers: `${roomId}:${userId}` → timer
    this._typingTimers = new Map();
  }

  // ── Group message ─────────────────────────────────────────────────────────────
  // frame type: 'send_message'
  // payload: { roomId, content, type?, replyTo? }
  async onSendMessage(connId, { roomId, content, type = 'text', replyTo }) {
    const user = this._store.getUserByConn(connId);
    if (!user) { this._ws.sendTo(connId, S.ERROR, { message: 'Not authenticated' }); return; }
    if (!content?.trim()) { this._ws.sendTo(connId, S.ERROR, { message: 'Empty message' }); return; }

    this._clearTyping(roomId, user.userId);
    this._store.setTyping(roomId, user.userId, false);

    const msg = this._store.addMessage(roomId, {
      senderId: user.userId,
      senderName: user.username,
      content: content.trim(),
      type,
      replyTo: replyTo || null,
    });

    if (!msg) {
      this._ws.sendTo(connId, S.ERROR, { message: `Room ${roomId} not found. Join first.` });
      return;
    }

    // Broadcast to all room members
    this._ws.broadcastRoom(roomId, S.NEW_MESSAGE, msg);

    // Auto-deliver to online members + Novu for offline
    const members = this._store.getRoomMembers(roomId);
    for (const memberId of members) {
      if (memberId === user.userId) continue;
      if (this._store.isOnline(memberId)) {
        this._store.updateMessageStatus(roomId, msg.id, memberId, 'delivered');
        this._ws.sendTo(connId, S.MESSAGE_STATUS, {
          messageId: msg.id, roomId, status: 'delivered', by: memberId,
        });
      } else {
        await this._notifs.sendMessageNotification({
          toUserId: memberId,
          fromUsername: user.username,
          roomId,
          messagePreview: content,
        });
      }
    }

    console.log(`[Msg] 💬 [${roomId}] ${user.username}: ${content.slice(0, 50)}`);
  }

  // ── Direct message ────────────────────────────────────────────────────────────
  // frame type: 'send_dm'
  // payload: { toUserId, content, type?, replyTo? }
  async onSendDm(connId, { toUserId, content, type = 'text', replyTo }) {
    const user = this._store.getUserByConn(connId);
    if (!user) { this._ws.sendTo(connId, S.ERROR, { message: 'Not authenticated' }); return; }
    if (!toUserId) { this._ws.sendTo(connId, S.ERROR, { message: 'toUserId required' }); return; }
    if (!content?.trim()) { this._ws.sendTo(connId, S.ERROR, { message: 'Empty message' }); return; }
    if (toUserId === user.userId) { this._ws.sendTo(connId, S.ERROR, { message: 'Cannot DM yourself' }); return; }

    const dmRoomId = Store.getDmRoomId(user.userId, toUserId);

    // Ensure both are in the private room
    this._store.joinRoom(dmRoomId, user.userId);
    this._store.joinRoom(dmRoomId, toUserId);
    this._rooms.join(dmRoomId, connId);

    const recipConnId = this._store.getConnIdForUser(toUserId);
    if (recipConnId) this._rooms.join(dmRoomId, recipConnId);

    this._clearTyping(dmRoomId, user.userId);
    this._store.setTyping(dmRoomId, user.userId, false);

    const msg = this._store.addMessage(dmRoomId, {
      senderId: user.userId,
      senderName: user.username,
      content: content.trim(),
      type,
      replyTo: replyTo || null,
    });

    // Emit ONLY to the two participants
    this._ws.broadcastRoom(dmRoomId, S.NEW_DM, { ...msg, toUserId });

    // Deliver or notify
    if (this._store.isOnline(toUserId)) {
      this._store.updateMessageStatus(dmRoomId, msg.id, toUserId, 'delivered');
      this._ws.sendTo(connId, S.MESSAGE_STATUS, {
        messageId: msg.id, roomId: dmRoomId, status: 'delivered', by: toUserId,
      });
    } else {
      await this._notifs.sendMessageNotification({
        toUserId,
        fromUsername: user.username,
        roomId: dmRoomId,
        messagePreview: content,
      });
    }

    console.log(`[Msg] 📩 DM ${user.username} → ${toUserId}: ${content.slice(0, 50)}`);
  }

  // frame type: 'get_dm_history'
  // payload: { toUserId }
  onGetDmHistory(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    const dmRoomId = Store.getDmRoomId(user.userId, toUserId);
    // Ensure room is initialized in the store even if no messages sent yet
    this._store.getOrCreateRoom(dmRoomId);
    const messages = this._store.getMessages(dmRoomId)?.slice()?.reverse();
    this._ws.sendTo(connId, S.DM_HISTORY, { toUserId, roomId: dmRoomId, messages });
  }

  // frame type: 'message_delivered'
  // payload: { roomId, messageId }
  onMessageDelivered(connId, { roomId, messageId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    const msg = this._store.updateMessageStatus(roomId, messageId, user.userId, 'delivered');
    if (msg) {
      this._ws.sendToUser(msg.senderId, S.MESSAGE_STATUS, {
        messageId, roomId, status: 'delivered', by: user.userId,
      });
    }
  }

  // frame type: 'message_read'
  // payload: { roomId, messageId }
  onMessageRead(connId, { roomId, messageId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    const msg = this._store.updateMessageStatus(roomId, messageId, user.userId, 'read');
    if (msg) {
      this._ws.sendToUser(msg.senderId, S.MESSAGE_STATUS, {
        messageId, roomId, status: 'read', by: user.userId,
      });
    }
  }

  // ── Typing (group) ────────────────────────────────────────────────────────────

  onTypingStart(connId, { roomId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;

    const typingUsers = this._store.setTyping(roomId, user.userId, true);
    this._ws.broadcastRoom(roomId, S.TYPING_UPDATE, {
      roomId,
      typingUsers,
      typingUsernames: typingUsers.map(uid => this._store.getUserById(uid)?.username || uid),
    }, connId);

    this._startTypingTimer(roomId, user.userId);
  }

  onTypingStop(connId, { roomId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._clearTyping(roomId, user.userId);
    const typingUsers = this._store.setTyping(roomId, user.userId, false);
    this._ws.broadcastRoom(roomId, S.TYPING_UPDATE, {
      roomId,
      typingUsers,
      typingUsernames: typingUsers.map(uid => this._store.getUserById(uid)?.username || uid),
    }, connId);
  }

  // ── Typing (DM) ───────────────────────────────────────────────────────────────

  onDmTypingStart(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    const dmRoomId = Store.getDmRoomId(user.userId, toUserId);
    this._ws.sendToUser(toUserId, S.DM_TYPING_UPDATE, {
      fromUserId: user.userId, fromUsername: user.username, isTyping: true,
    });
    this._startTypingTimer(dmRoomId, user.userId);
  }

  onDmTypingStop(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    const dmRoomId = Store.getDmRoomId(user.userId, toUserId);
    this._clearTyping(dmRoomId, user.userId);
    this._ws.sendToUser(toUserId, S.DM_TYPING_UPDATE, {
      fromUserId: user.userId, fromUsername: user.username, isTyping: false,
    });
  }

  // ── Typing timer helpers ──────────────────────────────────────────────────────

  _startTypingTimer(roomId, userId) {
    const key = `${roomId}:${userId}`;
    this._clearTyping(roomId, userId);
    this._typingTimers.set(key, setTimeout(() => {
      this._store.setTyping(roomId, userId, false);
      // Broadcast the cleared state (best-effort — don't need a connId here)
      this._typingTimers.delete(key);
    }, 5000));
  }

  _clearTyping(roomId, userId) {
    const key = `${roomId}:${userId}`;
    if (this._typingTimers.has(key)) {
      clearTimeout(this._typingTimers.get(key));
      this._typingTimers.delete(key);
    }
  }

  // Called by the disconnect flow to clean up all timers for a user
  clearAllTypingForUser(userId) {
    this._typingTimers.forEach((timer, key) => {
      if (key.endsWith(`:${userId}`)) {
        clearTimeout(timer);
        this._typingTimers.delete(key);
      }
    });
  }
}

module.exports = MessageHandler;
