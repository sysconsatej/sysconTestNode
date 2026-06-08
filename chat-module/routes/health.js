'use strict';
const { Router } = require("express")


/**
 * @param {import('../core/store')}  store
 * @param {import('../core/ws-server')}  ws
 */

module.exports = function healthRoutes(store, ws) {
    const router = Router();

    router.get("/", (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: Date.now(),
            connections: ws?.connectionCont,
            onlineUsers: store.getOnlineUsers().length,
            memory: process.memoryUsage().heapUsed,
        })
    })


    return router;
}
