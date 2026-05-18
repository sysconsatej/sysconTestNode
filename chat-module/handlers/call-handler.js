// handlers/CallHandler.js — pure relay, never touches SDP or ICE

'use strict';

const { S } = require('../core/protocol');

class CallHandler {
  constructor(store, ws) {
    this._store = store;
    this._ws    = ws;
  }

  onCallUser(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    if (!this._store.isOnline(toUserId)) {
      this._ws.sendTo(connId, S.CALL_UNAVAILABLE, { toUserId }); return;
    }
    this._ws.sendToUser(toUserId, S.INCOMING_CALL, {
      fromUserId: user.userId, fromUsername: user.username,
    });
    console.log(`[Call] 📞 ${user.username} → ${toUserId}`);
  }

  onCallAccepted(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.CALL_ACCEPTED, { fromUserId: user.userId });
  }

  onCallRejected(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.CALL_REJECTED, { fromUserId: user.userId });
  }

  onCallOffer(connId, { toUserId, sdp }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.CALL_OFFER, { fromUserId: user.userId, sdp });
  }

  onCallAnswer(connId, { toUserId, sdp }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.CALL_ANSWER, { fromUserId: user.userId, sdp });
  }

  onIceCandidate(connId, { toUserId, candidate }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.ICE_CANDIDATE, { fromUserId: user.userId, candidate });
  }

  onEndCall(connId, { toUserId }) {
    const user = this._store.getUserByConn(connId);
    if (!user) return;
    this._ws.sendToUser(toUserId, S.CALL_ENDED, { fromUserId: user.userId });
    console.log(`[Call] 📵 ${user.username} ended call with ${toUserId}`);
  }
}

module.exports = CallHandler;
