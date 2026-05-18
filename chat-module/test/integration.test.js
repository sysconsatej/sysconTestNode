// test/integration.js — integration test suite
// Run: npm test   (starts server internally, tears it down after)
'use strict';

require('dotenv').config();

const { createServer } = require('node:http');
const { Server }       = require('socket.io');
const { io: Client }   = require('socket.io-client');
const assert           = require('node:assert');

// ── Inline server bootstrap (same as chat-server.js but on a random port) ──────────
const express          = require('express');
const cors             = require('cors');

const Store               = require('../core/store');
const RoomRegistry        = require('../core/room-registry');
const WSServer            = require('../core/ws-server');
const Router              = require('../core/router');
const { C, S }            = require('../core/protocol');
const AuthHandler         = require('../handlers/auth.handler');
const RoomHandler         = require('../handlers/room.handler');
const MessageHandler      = require('../handlers/message.handler');
const CallHandler         = require('../handlers/call-handler');
const NotificationService = require('../services/notification.service');
const UploadService       = require('../services/upload.service');
const mountRoutes         = require('../routes');

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function ok(label) {
  console.log('  ✅', label);
  passed++;
}
function fail(label, reason) {
  console.log('  ❌', label, reason ? `— ${reason}` : '');
  failed++;
  errors.push({ label, reason });
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`);
}

// ── Server factory ────────────────────────────────────────────────────────────
function createTestServer() {
  const app  = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());

  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: { origin: '*' },
    pingTimeout: 2000,
    pingInterval: 1000,
  });

  const store         = new Store();
  const notifs        = new NotificationService();
  const uploadService = new UploadService();
  const rooms         = new RoomRegistry(io);
  const ws            = new WSServer(io, store, rooms);

  app.use('/api', mountRoutes(store, ws, uploadService));

  const authHandler   = new AuthHandler(store, ws, notifs);
  const roomHandler   = new RoomHandler(store, ws, rooms);
  const msgHandler    = new MessageHandler(store, ws, rooms, notifs);
  const callHandler   = new CallHandler(store, ws);

  const router = new Router();
  router.register(authHandler,  [C.AUTH, C.PING]);
  router.register(roomHandler,  [C.JOIN_ROOM, C.LEAVE_ROOM]);
  router.register(msgHandler, [
    C.SEND_MESSAGE,    C.SEND_DM,         C.GET_DM_HISTORY,
    C.MESSAGE_DELIVERED, C.MESSAGE_READ,
    C.TYPING_START,    C.TYPING_STOP,
    C.DM_TYPING_START, C.DM_TYPING_STOP,
  ]);
  router.register(callHandler, [
    C.CALL_USER, C.CALL_ACCEPTED, C.CALL_REJECTED,
    C.CALL_OFFER, C.CALL_ANSWER, C.ICE_CANDIDATE, C.END_CALL,
  ]);

  const EVENTS = [
    C.AUTH, C.PING, C.JOIN_ROOM, C.LEAVE_ROOM,
    C.SEND_MESSAGE, C.SEND_DM, C.GET_DM_HISTORY,
    C.MESSAGE_DELIVERED, C.MESSAGE_READ,
    C.TYPING_START, C.TYPING_STOP, C.DM_TYPING_START, C.DM_TYPING_STOP,
    C.CALL_USER, C.CALL_ACCEPTED, C.CALL_REJECTED,
    C.CALL_OFFER, C.CALL_ANSWER, C.ICE_CANDIDATE, C.END_CALL,
  ];

  io.on('connection', socket => {
    const connId = socket.id;
    EVENTS.forEach(type => {
      socket.on(type, payload => router.dispatch(connId, { type, payload: payload || {} }));
    });
    socket.on('disconnect', () => {
      const user = store.removeConn(connId);
      if (!user) return;
      rooms.leaveAll(connId);
      msgHandler.clearAllTypingForUser(user.userId);
      ws.broadcastAll(S.USER_OFFLINE, { userId: user.userId, username: user.username, lastSeen: Date.now() }, connId);
    });
  });

  return { httpServer, store, ws };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function waitFor(emitter, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    emitter.once(event, data => { clearTimeout(t); resolve(data); });
  });
}

function connectClient(url, userId, username) {
  return new Promise((resolve, reject) => {
    const c = Client(url, { reconnection: false });
    const t = setTimeout(() => reject(new Error('connect timeout')), 2000);
    c.once('connect', () => {
      clearTimeout(t);
      c.emit(C.AUTH, { userId, username });
      resolve(c);
    });
    c.once('connect_error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('🧪  Chat Server — Integration Tests\n');

  const { httpServer, store, ws } = createTestServer();

  // Start on a random available port
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const { port } = httpServer.address();
  const BASE = `http://127.0.0.1:${port}`;
  console.log(`   server on port ${port}\n`);

  // ── 1. AUTH ────────────────────────────────────────────────────────────────
  section('Auth');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const authResult = await waitFor(c1, S.AUTH_SUCCESS);
    ok('auth_success received');
    assert(authResult.userId === 'u1', 'userId mismatch');
    ok('auth_success.userId correct');
    assert(Array.isArray(authResult.onlineUsers), 'onlineUsers not array');
    ok('auth_success.onlineUsers is array');
    c1.disconnect();
  } catch(e) { fail('auth', e.message); }

  await sleep(100);

  // ── 2. PRESENCE ────────────────────────────────────────────────────────────
  section('Presence');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = Client(BASE, { reconnection: false });
    c2.connect();

    const onlineEvt = waitFor(c1, S.USER_ONLINE);
    await new Promise(r => c2.once('connect', r));
    c2.emit(C.AUTH, { userId: 'u2', username: 'Bob' });

    const d = await onlineEvt;
    assert(d.username === 'Bob', 'wrong username in user_online');
    ok('user_online broadcast received');

    const offlineEvt = waitFor(c1, S.USER_OFFLINE);
    c2.disconnect();
    const od = await offlineEvt;
    assert(od.userId === 'u2', 'wrong userId in user_offline');
    ok('user_offline broadcast received');
    c1.disconnect();
  } catch(e) { fail('presence', e.message); }

  await sleep(100);

  // ── 3. ROOMS ───────────────────────────────────────────────────────────────
  section('Rooms');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');

    c1.emit(C.JOIN_ROOM, { roomId: 'general' });
    c2.emit(C.JOIN_ROOM, { roomId: 'general' });

    const history = await waitFor(c1, S.ROOM_HISTORY);
    assert(history.roomId === 'general', 'wrong roomId in history');
    ok('room_history received on join');
    assert(Array.isArray(history.messages), 'messages not array');
    ok('room_history.messages is array');

    const joinedEvt = waitFor(c1, S.USER_JOINED_ROOM);
    c2.emit(C.JOIN_ROOM, { roomId: 'general' }); // c2 joins again to trigger event for c1
    await joinedEvt;
    ok('user_joined_room received');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('rooms', e.message); }

  await sleep(100);

  // ── 4. GROUP MESSAGING ─────────────────────────────────────────────────────
  section('Group Messaging');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');

    c1.emit(C.JOIN_ROOM, { roomId: 'general' });
    c2.emit(C.JOIN_ROOM, { roomId: 'general' });
    await sleep(100);

    const msgEvt = waitFor(c2, S.NEW_MESSAGE);
    c1.emit(C.SEND_MESSAGE, { roomId: 'general', content: 'Hello group!' });
    const msg = await msgEvt;

    assert(msg.senderName === 'Alice', 'wrong sender');
    ok('new_message received by other user');
    assert(msg.content === 'Hello group!', 'wrong content');
    ok('new_message.content correct');
    assert(msg.id, 'message has no id');
    ok('new_message has id');
    assert(msg.createdAt, 'message has no createdAt');
    ok('new_message has createdAt');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('group messaging', e.message); }

  await sleep(100);

  // ── 5. REPLY / replyTo ─────────────────────────────────────────────────────
  section('Reply with Quote');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');

    c1.emit(C.JOIN_ROOM, { roomId: 'general' });
    c2.emit(C.JOIN_ROOM, { roomId: 'general' });
    await sleep(100);

    const evt = waitFor(c2, S.NEW_MESSAGE);
    c1.emit(C.SEND_MESSAGE, {
      roomId: 'general',
      content: 'Replying!',
      replyTo: { id: 'abc', senderId: 'u2', senderName: 'Bob', content: 'Original', type: 'text' },
    });
    const msg = await evt;
    assert(msg.replyTo !== null, 'replyTo is null');
    ok('replyTo preserved on message');
    assert(msg.replyTo.content === 'Original', 'replyTo.content wrong');
    ok('replyTo.content correct');
    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('reply', e.message); }

  await sleep(100);

  // ── 6. DIRECT MESSAGES ─────────────────────────────────────────────────────
  section('Direct Messages');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');
    const c3 = await connectClient(BASE, 'u3', 'Charlie'); // must NOT receive DM
    await sleep(100);

    let c3GotDm = false;
    c3.on(S.NEW_DM, () => { c3GotDm = true; });

    const dmEvt = waitFor(c1, S.NEW_DM);
    c2.emit(C.SEND_DM, { toUserId: 'u1', content: 'Private!' });
    const dm = await dmEvt;

    assert(dm.senderName === 'Bob', 'wrong DM sender');
    ok('new_dm received by recipient');
    assert(dm.content === 'Private!', 'wrong DM content');
    ok('new_dm.content correct');
    assert(dm.toUserId === 'u1', 'toUserId missing from DM');
    ok('new_dm.toUserId correct');

    await sleep(200);
    assert(!c3GotDm, 'c3 received a DM it should not have');
    ok('DM isolated — third user did not receive it');

    c1.disconnect(); c2.disconnect(); c3.disconnect();
  } catch(e) { fail('direct messages', e.message); }

  await sleep(100);

  // ── 7. DM HISTORY ──────────────────────────────────────────────────────────
  section('DM History');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');
    await sleep(100);

    // Send a DM first
    c2.emit(C.SEND_DM, { toUserId: 'u1', content: 'Hey Alice' });
    await sleep(150);

    // Fetch history
    const histEvt = waitFor(c1, S.DM_HISTORY);
    c1.emit(C.GET_DM_HISTORY, { toUserId: 'u2' });
    const hist = await histEvt;

    assert(hist.messages.length >= 1, 'no messages in DM history');
    ok('dm_history returned messages');
    assert(hist.messages[0].content === 'Hey Alice', 'wrong message in history');
    ok('dm_history content correct');
    assert(hist.toUserId === 'u2', 'toUserId wrong in dm_history');
    ok('dm_history.toUserId correct');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('dm history', e.message); }

  await sleep(100);

  // ── 8. MESSAGE STATUS ──────────────────────────────────────────────────────
  section('Message Status (delivered / read)');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');

    c1.emit(C.JOIN_ROOM, { roomId: 'general' });
    c2.emit(C.JOIN_ROOM, { roomId: 'general' });
    await sleep(100);

    const statusEvts = [];
    c1.on(S.MESSAGE_STATUS, d => statusEvts.push(d));

    c1.emit(C.SEND_MESSAGE, { roomId: 'general', content: 'Status test' });
    await sleep(300);

    const delivered = statusEvts.find(s => s.status === 'delivered');
    assert(delivered, 'no delivered status received');
    ok('message_status delivered received by sender');

    // Now Bob marks it read
    const readEvt = waitFor(c1, S.MESSAGE_STATUS);
    c2.emit(C.MESSAGE_READ, { roomId: 'general', messageId: delivered.messageId });
    const readStatus = await readEvt;
    assert(readStatus.status === 'read', 'status is not read');
    ok('message_status read received by sender');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('message status', e.message); }

  await sleep(100);

  // ── 9. TYPING INDICATORS ───────────────────────────────────────────────────
  section('Typing Indicators');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');

    c1.emit(C.JOIN_ROOM, { roomId: 'general' });
    c2.emit(C.JOIN_ROOM, { roomId: 'general' });
    await sleep(100);

    // Group typing
    const typingEvt = waitFor(c2, S.TYPING_UPDATE);
    c1.emit(C.TYPING_START, { roomId: 'general' });
    const td = await typingEvt;
    assert(td.typingUsers.includes('u1'), 'u1 not in typingUsers');
    ok('typing_update received (group)');

    const stopEvt = waitFor(c2, S.TYPING_UPDATE);
    c1.emit(C.TYPING_STOP, { roomId: 'general' });
    const ts = await stopEvt;
    assert(!ts.typingUsers.includes('u1'), 'u1 still in typingUsers after stop');
    ok('typing stopped (group)');

    // DM typing
    const dmTypingEvt = waitFor(c1, S.DM_TYPING_UPDATE);
    c2.emit(C.DM_TYPING_START, { toUserId: 'u1' });
    const dt = await dmTypingEvt;
    assert(dt.fromUserId === 'u2', 'wrong fromUserId in DM typing');
    ok('dm_typing_update received');
    assert(dt.isTyping === true, 'isTyping should be true');
    ok('dm_typing_update.isTyping = true');

    const dmStopEvt = waitFor(c1, S.DM_TYPING_UPDATE);
    c2.emit(C.DM_TYPING_STOP, { toUserId: 'u1' });
    const ds = await dmStopEvt;
    assert(ds.isTyping === false, 'isTyping should be false after stop');
    ok('dm_typing stopped');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('typing', e.message); }

  await sleep(100);

  // ── 10. CALL SIGNALING ─────────────────────────────────────────────────────
  section('Call Signaling (WebRTC relay)');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const c2 = await connectClient(BASE, 'u2', 'Bob');
    await sleep(100);

    // Alice calls Bob
    const incomingEvt = waitFor(c2, S.INCOMING_CALL);
    c1.emit(C.CALL_USER, { toUserId: 'u2' });
    const incoming = await incomingEvt;
    assert(incoming.fromUserId === 'u1', 'wrong fromUserId in incoming_call');
    ok('incoming_call received');
    assert(incoming.fromUsername === 'Alice', 'wrong username in incoming_call');
    ok('incoming_call.fromUsername correct');

    // Bob accepts
    const acceptedEvt = waitFor(c1, S.CALL_ACCEPTED);
    c2.emit(C.CALL_ACCEPTED, { toUserId: 'u1' });
    await acceptedEvt;
    ok('call_accepted relayed');

    // Alice sends offer
    const offerEvt = waitFor(c2, S.CALL_OFFER);
    c1.emit(C.CALL_OFFER, { toUserId: 'u2', sdp: { type: 'offer', sdp: 'fake-sdp' } });
    const offer = await offerEvt;
    assert(offer.sdp.type === 'offer', 'offer SDP not relayed correctly');
    ok('call_offer relayed (SDP intact)');

    // Bob answers
    const answerEvt = waitFor(c1, S.CALL_ANSWER);
    c2.emit(C.CALL_ANSWER, { toUserId: 'u1', sdp: { type: 'answer', sdp: 'fake-answer' } });
    await answerEvt;
    ok('call_answer relayed');

    // ICE candidates
    const iceEvt = waitFor(c2, S.ICE_CANDIDATE);
    c1.emit(C.ICE_CANDIDATE, { toUserId: 'u2', candidate: { candidate: 'fake-ice' } });
    const ice = await iceEvt;
    assert(ice.candidate.candidate === 'fake-ice', 'ICE candidate not relayed');
    ok('ice_candidate relayed');

    // Alice hangs up
    const endedEvt = waitFor(c2, S.CALL_ENDED);
    c1.emit(C.END_CALL, { toUserId: 'u2' });
    await endedEvt;
    ok('call_ended relayed');

    // Call to offline user
    const unavailEvt = waitFor(c1, S.CALL_UNAVAILABLE);
    c1.emit(C.CALL_USER, { toUserId: 'u99' }); // u99 doesn't exist
    await unavailEvt;
    ok('call_unavailable sent for offline user');

    c1.disconnect(); c2.disconnect();
  } catch(e) { fail('call signaling', e.message); }

  await sleep(100);

  // ── 11. PING ───────────────────────────────────────────────────────────────
  section('Ping / Pong');
  try {
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    const pongEvt = waitFor(c1, S.PONG);
    c1.emit(C.PING);
    const pong = await pongEvt;
    assert(typeof pong.ts === 'number', 'pong has no ts');
    ok('pong received with timestamp');
    c1.disconnect();
  } catch(e) { fail('ping', e.message); }

  await sleep(100);

  // ── 12. REST API ───────────────────────────────────────────────────────────
  section('REST API');
  try {
    const http = require('http');

    function get(urlPath) {
      return new Promise((resolve, reject) => {
        http.get(`${BASE}/api${urlPath}`, res => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
            catch(e) { reject(new Error('invalid JSON: ' + body)); }
          });
        }).on('error', reject);
      });
    }

    // health
    const h = await get('/health');
    assert(h.status === 200, 'health not 200');
    assert(h.body.status === 'ok', 'health status not ok');
    ok('GET /api/health → 200 ok');

    // connect a user so /users/online has data
    const c1 = await connectClient(BASE, 'u1', 'Alice');
    await sleep(100);

    const u = await get('/users/online');
    assert(u.status === 200, '/users/online not 200');
    assert(u.body.count >= 1, 'no online users');
    ok('GET /api/users/online → users present');

    const s = await get('/users/u1/status');
    assert(s.body.online === true, 'u1 should be online');
    ok('GET /api/users/:userId/status → online=true');

    // upload config
    const cfg = await get('/upload/config');
    assert(cfg.status === 200, '/upload/config not 200');
    assert(cfg.body.maxSizeMb === 5, 'maxSizeMb wrong');
    ok('GET /api/upload/config → maxSizeMb=5');
    assert(Array.isArray(cfg.body.allowedExtensions), 'allowedExtensions not array');
    ok('GET /api/upload/config → allowedExtensions is array');

    c1.disconnect();
  } catch(e) { fail('REST API', e.message); }

  await sleep(100);

  // ── 13. STORE (unit) ───────────────────────────────────────────────────────
  section('Store (unit)');
  try {
    const s = new Store();

    s.registerConn('conn1', { userId: 'u1', username: 'Alice' });
    assert(s.isOnline('u1'), 'u1 should be online');
    ok('registerConn + isOnline');

    assert(s.getUserByConn('conn1').username === 'Alice', 'getUserByConn wrong');
    ok('getUserByConn');

    assert(s.getConnIdForUser('u1') === 'conn1', 'getConnIdForUser wrong');
    ok('getConnIdForUser');

    s.joinRoom('general', 'u1');
    assert(s.getRoomMembers('general').includes('u1'), 'u1 not in room');
    ok('joinRoom + getRoomMembers');

    const msg = s.addMessage('general', { senderId:'u1', senderName:'Alice', content:'Hello' });
    assert(msg.id, 'message has no id');
    assert(msg.status === 'sent', 'initial status should be sent');
    ok('addMessage returns message with id and status=sent');

    s.updateMessageStatus('general', msg.id, 'u2', 'delivered');
    const msgs = s.getMessages('general');
    assert(msgs[0].status === 'delivered', 'status not updated to delivered');
    ok('updateMessageStatus → delivered');

    s.updateMessageStatus('general', msg.id, 'u2', 'read');
    assert(s.getMessages('general')[0].status === 'read', 'status not updated to read');
    ok('updateMessageStatus → read');

    const typing = s.setTyping('general', 'u1', true);
    assert(typing.includes('u1'), 'u1 not in typing');
    ok('setTyping true');

    s.setTyping('general', 'u1', false);
    assert(!s.getTypingUsers('general').includes('u1'), 'u1 still typing after false');
    ok('setTyping false');

    assert(Store.getDmRoomId('u1','u5') === Store.getDmRoomId('u5','u1'), 'DM roomId not deterministic');
    ok('getDmRoomId is deterministic (order-independent)');

    const removed = s.removeConn('conn1');
    assert(removed.userId === 'u1', 'removeConn returned wrong user');
    assert(!s.isOnline('u1'), 'u1 still online after removeConn');
    ok('removeConn cleans up correctly');

  } catch(e) { fail('store unit', e.message); }

  // ── 14. PROTOCOL (unit) ────────────────────────────────────────────────────
  section('Protocol (unit)');
  try {
    const { C, S, frame, parse } = require('../core/protocol');

    const f = frame('test_event', { hello: 'world' });
    const parsed = parse(f);
    assert(parsed.type === 'test_event', 'frame type wrong');
    assert(parsed.payload.hello === 'world', 'frame payload wrong');
    assert(parsed.id, 'frame has no id');
    assert(parsed.ts, 'frame has no ts');
    ok('frame() + parse() round-trip');

    assert(parse('not json') === null, 'invalid JSON should return null');
    ok('parse() returns null for invalid JSON');

    assert(parse('{"no_type":true}') === null, 'missing type should return null');
    ok('parse() returns null for missing type');

    assert(Object.keys(C).length >= 20, 'C constants incomplete');
    ok('C has all client→server event constants');

    assert(Object.keys(S).length >= 18, 'S constants incomplete');
    ok('S has all server→client event constants');

  } catch(e) { fail('protocol unit', e.message); }

  // ── Results ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(52));
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  console.log('═'.repeat(52));

  if (errors.length) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log(`  ❌  ${e.label}${e.reason ? ' — '+e.reason : ''}`));
  }

  await new Promise(r => httpServer.close(r));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('💥 Test runner crashed:', e);
  process.exit(1);
});