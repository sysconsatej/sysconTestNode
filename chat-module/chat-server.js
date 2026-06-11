'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

// core 
const Store = require('./core/store');
const RoomRegistry = require('./core/room-registry');
const WSServer = require('./core/ws-server');
const Router = require('./core/router');
const { C , S } = require('./core/protocol');

// handlers
const AuthHandler = require('./handlers/auth.handler');
const RoomHandler = require('./handlers/room.handler');
const MessageHandler = require('./handlers/message.handler');
const CallHandler = require('./handlers/call-handler');

// services
const NotificationService = require('./services/notification.service');
const UploadService = require('./services/upload.service');

// ── REST routes (injected with store + ws + uploadService) ────────────────────
const mountRoutes = require('./routes/index');

// ports and ssl certs

const PORT = process.env.CHAT_PORT || 8981;
const PORT_HTTPS = process.env.PORT_HTTPS || 3443;
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY = process.env.SSL_KEY;

// ── Express — mounted after store/ws/uploadService are created below ──────────
const app = express();
app.use(cors({ origin: '*' , methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'chat-uploads')));

// ── HTTP / HTTPS 
let httpServer;

if (SSL_CERT && SSL_KEY) {
    try {
        const opts = { cert: fs.readFileSync(SSL_CERT), key: fs.readFileSync(SSL_KEY) };
        httpServer = https.createServer(opts, app);
        http.createServer((req, res) => {
            const host = req.headers.host?.replace(/:\d+$/, '');
            res.writeHead(301, { Location: `https://${host}:${PORT_HTTPS}${req.url}` });
            res.end();
        }).listen(PORT, () => console.log(`↩️  HTTP :${PORT} → HTTPS :${PORT_HTTPS}`));
        console.log('🔒 SSL certs loaded');
    } catch (e) {
        console.error(`❌ SSL error: ${e.message} — falling back to HTTP`);
        httpServer = http.createServer(app);
    }
} else {
    httpServer = http.createServer(app);
}

// ── Socket.IO ───
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
});

// ── Instantiate core + services
const store = new Store();
const notifs = new NotificationService();
const uploadService = new UploadService();
notifs.init();

// RoomRegistry and WSServer need io first
const rooms = new RoomRegistry(io);
const ws = new WSServer(io, store, rooms);

// Mount REST routes now that all dependencies exist
app.use('/api', mountRoutes(store, ws, uploadService));

// ── Instantiate handlers (all receive same store/ws/rooms/notifs)
const authHandler = new AuthHandler(store, ws, notifs);
const roomHandler = new RoomHandler(store, ws, rooms);
const msgHandler = new MessageHandler(store, ws, rooms, notifs);
const callHandler = new CallHandler(store, ws);

// ── Router — maps frame type constants → handler methods
const router = new Router();

router.register(authHandler, [C.AUTH, C.PING]);
router.register(roomHandler, [C.JOIN_ROOM, C.LEAVE_ROOM]);
router.register(msgHandler, [
    C.SEND_MESSAGE, C.SEND_DM, C.GET_DM_HISTORY,
    C.MESSAGE_DELIVERED, C.MESSAGE_READ,
    C.TYPING_START, C.TYPING_STOP,
    C.DM_TYPING_START, C.DM_TYPING_STOP,
]);
router.register(callHandler, [
    C.CALL_USER, C.CALL_ACCEPTED, C.CALL_REJECTED,
    C.CALL_OFFER, C.CALL_ANSWER, C.ICE_CANDIDATE, C.END_CALL,
]);

// ── Socket.IO connection handler 
io.on('connection', socket => {
    const connId = socket.id;
    console.log(`[IO] 🔌 ${connId}`);

    // Route every incoming event through the Router
    // Socket.IO fires named events — we treat each event name as our frame type
    const ROUTED_EVENTS = [
        C.AUTH, C.PING,
        C.JOIN_ROOM, C.LEAVE_ROOM,
        C.SEND_MESSAGE, C.SEND_DM, C.GET_DM_HISTORY,
        C.MESSAGE_DELIVERED, C.MESSAGE_READ,
        C.TYPING_START, C.TYPING_STOP,
        C.DM_TYPING_START, C.DM_TYPING_STOP,
        C.CALL_USER, C.CALL_ACCEPTED, C.CALL_REJECTED,
        C.CALL_OFFER, C.CALL_ANSWER, C.ICE_CANDIDATE, C.END_CALL,
    ];

    ROUTED_EVENTS.forEach(eventType => {
        socket.on(eventType, payload => {
            router.dispatch(connId, { type: eventType, payload: payload || {} });
        });
    });

    // ── Disconnect 
    socket.on('disconnect', reason => {
        const user = store.removeConn(connId);
        if (!user) return;

        // clean up all rooms + typing timers
        rooms.leaveAll(connId);
        msgHandler.clearAllTypingForUser(user.userId);

        ws.broadcastAll(S.USER_OFFLINE, {
            userId: user.userId,
            username: user.username,
            lastSeen: Date.now(),
        }, connId);

        console.log(`[IO] ❌ ${user.username} disconnected (${reason})`);
    });
});

// ── Start 
const listenPort = (SSL_CERT && SSL_KEY) ? PORT_HTTPS : PORT;
const proto = (SSL_CERT && SSL_KEY) ? 'https' : 'http';

httpServer.listen(listenPort, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    const lanIp = Object.values(networkInterfaces()).flat()
        .find(n => n.family === 'IPv4' && !n.internal)?.address || 'YOUR_LAN_IP';

    console.log(`\n🚀 Chat server ready  [Socket.IO + class-based]`);
    console.log(`   localhost → ${proto}://localhost:${listenPort}`);
    console.log(`   LAN       → ${proto}://${lanIp}:${listenPort}`);
    console.log(`   API       → ${proto}://localhost:${listenPort}/api/health\n`);
    if (!SSL_CERT) console.log(`⚠️  No SSL — camera/mic blocked on LAN.\n`);
});

module.exports = { app, io, store, ws };
