'use strict'

const { Router } = require('express');
const Store = require("../core/store");

/**
 * @param  {import('../core/store')} store
 */


module.exports = function userRoutes(store) {
    const router = Router();


    router.get("/online", (req, res) => {
        const users = store.getOnlineUsers().map(u => ({
            userId: u?.userId,
            username: u?.username,
            avatar: u?.avatar,
            onlineAt: u?.onlineAt,
        }))

        res.json({ users, count: users.length });
    });


    // isUserOnline
    router.get(":/userid/status", (req, res) => {
        const { userId } = req.params;
        res.json({ userId, online: store.isOnline(userId) })
    })

    // message history
    router.get("/rooms/:roomId/messages", (req, res) => {
        const { roomId } = req.params;
        const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
        const messages = store.getMessages(roomId, limit);
        res.json({ roomId, messages, count: messages?.length })
    })


    // current typing in a room
    router.get("/rooms/:roomId/typing", (req, res) => {
        const { roomId } = req.params;
        res.json({
            roomId, typingUsers: store.getTypingUsers(roomId),
        })
    })





    // returns all members , with online status

    router.get('/rooms/:roomId/members', (req, res) => {
        const { roomId } = req.params;
        const members = store.getRoomMembers(roomId);
        res.json({
            roomId,
            members,
            online: members.filter(id => store.isOnline(id)),
            offline: members.filter(id => !store.isOnline(id)),
            count: members.length,
        })
    })
}
