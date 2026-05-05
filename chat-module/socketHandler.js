const store = require("./store");
const notifs = require("./notifications");

const typingTimers = new Map();

const clearTypingTimer = (roomId, userId) => {
    const key = `${roomId}:${userId}`;
    if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key));
        typingTimers.delete(key);
    }
}


const startTypingTimer = (io, roomId, userId, usrername) => {
    const key = `${roomId}:${userId}`;
    clearTypingTimer(roomId, userId);
    typingTimers.set(key, setTimeout(() => {
        const typingUsers = store.setTyping(roomId, userId, false);
        io?.to(roomId)?.emit('typing_update', { roomId, typingUsers });
    }, 5000))
}


const registerSocketHandlers = (io) => {
    io?.on('connection', (socket) => {
        console.info("Connected to Chat Server");
        // Client must emit 'register' first with user info
        socket?.on('register', ({ userId, username, avatar }) => {
            if (!userId || !username) {
                socket?.emit('error', { message: "Regiter requries UserId ans Username" })
                return;
            }


            store.registerSocket(socket?.id, { userId, username, avatar });
            notifs.upsertSubscriber({ userId, username });
            socket?.broadcast?.emit('user_online', { userId, username, avatar });

            socket?.emit('online_users', store.getOnlineUsers().map(u => ({
                userId: u?.userId,
                username: u?.username,
                avatar: u?.avatar,
            })))

            console.log(`[Socket] 👤 Registered: ${username} (${userId})`);

        })


        // ── ROOM MANAGEMENT ─────────────────────────────────────────────────────

        socket?.on('join_room', ({ roomId, roomName }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) {
                socket?.emit('error', { message: "User is not Regsiter" });
                return;
            }

            socket?.join(roomId);
            store.joinRoom(roomId, user?.userId);

            const history = store.getMessages(roomId);
            socket?.emit('room_history', { roomId, message: history });

            //notify others
            socket?.to(roomId)?.emit('user_joined_room', {
                roomId,
                userId: user?.userId,
                username: user?.username,
            })

            console.log(`[Socket] 🚪 ${user.username} joined room: ${roomId}`);

        })


        socket?.on('leave_room', ({ roomId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;

            socket?.leave(roomId);
            store.leaveRoom(roomId, user?.userId);
            clearTypingTimer(roomId, user?.userId);

            socket?.to(roomId)?.emit('user_left_room', {
                roomId,
                userId: user?.userId,
                username: user?.username,
            })
        })

        //messagings

        socket?.on('send_message', ({ roomId, content, type = 'text', replyTo }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) {
                socket?.emit('error', { message: "Not Registered User" });
                return;
            }

            if (!content?.trim()) {
                socket?.emit('error', { message: 'Empty Message' });
                return;
            }

            const msg = store.addMessages(roomId, {
                senderId: user?.userId,
                senderName: user?.username,
                cotnent: content?.trim(),
                type,
                replyTo: replyTo || null,
            })

            if (!msg) {
                socket?.emit('error', { message: `Room ${roomId} does not exist . Join it first` });
                return;
            }

            io?.to(roomId)?.emit('new_message', msg);

            const members = store.getRoomMembers(roomId);
            members?.forEach(memberId => {
                if (memberId !== user?.userId && store.isUserOnline(memberId)) {
                    const updated = store.updateMessageStatus(roomId, msg?.id, memberId, 'delivered');
                    if (updated) {
                        const senderSocketId = store.getUserById(user?.userId) ? io?.sockets?.sockets?.get(store.getOnlineUsers().find(u => u?.userId === user?.userId)?.socketId) : null;
                        socket?.emit('message_status', { messageId: msg?.id, status: 'delivered', by: memberId })
                    }
                }
            })

            // Send Novu notification to offline members
            for (const memberId of members) {
                if (memberId !== user?.userId && !store?.isUserOnline(memberId)) {
                    await notifs.sendMessageNotification({
                        toUserId: memberId,
                        fromUserName: user?.username,
                        roomId,
                        messagePreview: content,
                    })
                }
            }

            console.info(`[Socket] 💬 [${roomId}] ${user.username}: ${content.slice(0, 50)}`)


        })


        // ── DIRECT MESSAGES ──────────────────────────────────────────────────────
        // DMs use a private room: dm:<sortedId1>:<sortedId2>
        // The room is auto-created on first message; both users are auto-joined.

        socket?.on('send_dm', async ({ toUserId, content, type = 'text', replyTo }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) {
                socket?.emit('error', {
                    message: "User Not Registered"
                })
                return;
            }

            if (!toUserId) { socket.emit('error', { message: 'send_dm requires toUserId' }); return; }
            if (!content?.trim()) { socket.emit('error', { message: 'Empty message' }); return; }
            if (toUserId === user.userId) { socket.emit('error', { message: 'Cannot DM yourself' }); return; }

            const dmRoomId = store.getRoomId(user?.userId, toUserId);

            store.joinRoom(dmRoomId, user?.userId)
            store.joinRoom(dmRoomId, toUserId);
            socket?.join(dmRoomId);

            const recipientSocketId = store.getOnlineUsers().find(u => u?.id === toUserId)?.socketId;
            if (recipientSocketId) {
                const recipientSocket = io?.sockets?.sockets?.get(recipientSocketId);
                if (recipientSocket) recipientSocket?.join(dmRoomId);
            }

            clearTypingTimer(dmRoomId, user?.userId);
            store.setTyping(dmRoomId, user?.userId, false);

            const msg = store.addMessages(dmRoomId, {
                senderId: user?.userId,
                senderName: user?.username,
                content: content?.trim(),
                type,
                replyTo: replyTo || null,
            })


            // Emit ONLY to the two participants via the private room
            io?.to(dmRoomId)?.emit('new_dm', { ...msg, toUserId })

            if (store?.isUserOnline(toUserId)) {
                store.updateMessageStatus(dmRoomId, msg?.id, toUserId, 'delivered');
                socket?.emit('message_status', { messageId: msg?.id, roomId: dmRoomId, status: 'delivered', by: toUserId })
            } else {
                await notifs.sendMessageNotification({
                    fromUserName: user?.username,
                    toUserId,
                    roomId: dmRoomId,
                    messagePreview: content,
                })
            }
            console.log(`[Socket] 📩 DM ${user.username} → ${toUserId}: ${content.slice(0, 50)}`);

        })


        // Fetch DM history between two users
        socket?.on('get_dm_history', ({ toUserId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) {
                socket?.emit('error', { message: 'User is not Registered' })
                return;
            }
            const dmRoomId = store.getRoomId(user?.userId, toUserId);
            const history = store.getMessages(dmRoomId);
            socket?.emit('dm_history', { toUserId, roomId: dmRoomId, message: history })
        })

        // dm typing indicators

        socket?.on('dm_typing_start', ({ toUserId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;
            const dmRoomId = store.getRoomId(user?.userId, toUserId);

            const recipientSocketId = store.getOnlineUsers().find(u => u?.userId === toUserId)?.socketId;
            if (recipientSocketId) {
                io?.to(recipientSocketId)?.emit('dm_typing_update', {
                    fromUserId: user.userId,
                    fromUsername: user.username,
                    isTyping: true,
                })
            }

            startTypingTimer(io, dmRoomId, user?.userId, user?.username);

        })


        socket?.on('dm_typing_stop', ({ toUserId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;

            const dmRoomId = store.getRoomId(user?.userId, toUserId);
            clearTypingTimer(dmRoomId, user?.userId);

            const recipientSocketId = store.getOnlineUsers().find(u => u.userId === toUserId)?.socketId;
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('dm_typing_update', {
                    fromUserId: user.userId,
                    fromUsername: user.username,
                    isTyping: false,
                });
            }
        })

        socket?.on('typing_start', ({ roomId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;

            const typingUsers = store.setTyping(roomId, user?.userId, true);
            socket?.to(roomId)?.emit('typing_update', {
                roomId,
                typingUsers,
                typingUsernames: typingUsers.map(uid => {
                    const u = store.getUserById(uid);
                    return u ? u.username : uid;
                }),
            })


            // Auto-stop after 5s
            startTypingTimer(io, roomId, user?.userId, user?.username);
        })

        socket?.on('typing_stop', ({ roomId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return user;


            clearTypingTimer(roomId, user?.userId);
            const typingUsers = store.setTyping(roomId, user?.userId, false);

            socket?.to(roomId)?.emit('typing_update', {
                roomId,
                typingUsers,
                typingUsernames: typingUsers.map(uid => {
                    const u = store.getUserById(uid);
                    return u ? u.username : uid;
                }),
            });
        })

        // ── MESSAGE STATUS ───────────────────────────────────────────────────────
        socket?.on('message_delivered', ({ roomId, messageId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;

            const msg = store.updateMessageStatus(roomId, messageId, user?.userId, 'delivered');
            if (msg) {
                const senderSocketId = store.getOnlineUsers().find(u => u?.userId === msg?.senderId)?.socketId;
                if (senderSocketId) {
                    io?.to(senderSocketId)?.emit('message_status', { messageId, roomId, status: 'delivered', by: user.userId })
                }
            }
        })

        socket.on('message_read', ({ roomId, messageId }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;

            const msg = store.updateMessageStatus(roomId, messageId, user.userId, 'read');
            if (msg) {
                const senderSocketId = store.getOnlineUsers().find(u => u.userId === msg.senderId)?.socketId;
                if (senderSocketId) {
                    io.to(senderSocketId).emit('message_status', { messageId, roomId, status: 'read', by: user.userId });
                }
            }
        });

        // Video call 

        const peerSocket = (userId) => {
            return store.getOnlineUsers().find(u => u?.userId === userId)?.socketId || null;

        }

        socket?.on('call_user', ({ toUserId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;

            const target = peerSocket(toUserId);
            if (!target) {
                socket.emit('call_unavailable', { toUserId });
                return;
            }
            io.to(target).emit('incoming_call', { fromUserId: user?.userId, fromUsername: user?.username });
            console.log(`[Call] 📞 ${user.username} → ${toUserId}`);
        })

        socket?.on('call_accepted', ({ toUserId }) => {
            const user = store.getUserBySocket(socket?.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target)?.emit('call_accepted', {
                    fromUserId: user?.userId,
                })
            }
        })


        socket.on('call_rejected', ({ toUserId }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target).emit('call_rejected', { fromUserId: user.userId })
            };
        })

        socket.on('call_offer', ({ toUserId, sdp }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target)?.emit('call_offer', { fromUserId: user.userId, sdp })
            };
        });

        socket.on('call_answer', ({ toUserId, sdp }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target).emit('call_answer', { fromUserId: user.userId, sdp })
            };
        });


        socket.on('ice_candidate', ({ toUserId, candidate }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target).emit('ice_candidate', { fromUserId: user.userId, candidate })
            };
        });

        socket.on('end_call', ({ toUserId }) => {
            const user = store.getUserBySocket(socket.id);
            if (!user) return;
            const target = peerSocket(toUserId);
            if (target) {
                io?.to(target).emit('call_ended', { fromUserId: user.userId })
            };
            console.log(`[Call] 📵 ${user.username} ended call with ${toUserId}`);
        });

        // disconnect
        socket?.on('disconnect', (reason) => {
            const user = store.removeSocket(socket.id);
            if (user) {
                // Clean up typing in all rooms this user was in
                socket?.rooms.forEach(roomId => {
                    clearTypingTimer(roomId, user.userId);
                    store.setTyping(roomId, user.userId, false);
                    store.leaveRoom(roomId, user.userId);
                });

                socket?.broadcast.emit('user_offline', {
                    userId: user.userId,
                    username: user.username,
                    lastSeen: Date.now(),
                });

                console.log(`[Socket] ❌ Disconnected: ${user.username} (${reason})`);
            }
        });


        socket?.on('ping_server', () => {
            socket?.emit('pong_server', { timestamp: Date.now() });
        });



    })
}

