const { v4: uuidv4 } = require('uuid')

const getRoomId = (userIdA, userIdB) => {
    return 'dm:' + [userIdA, userIdB].sort().join(':');
}


const store = {
    sockets: new Map(), //  it holds socketId  =>  { userId  ,  username  ,  avatar , onlineAt  }
    userSockets: new Map(), //  userId  -> socketId  {   lastest socket  for that user    }
    rooms: new Map(),  //  roomId  ->  { id  , name  , members :  Ste<userId> , createdAt } 
    messages: new Map(), // roomId -> Message[]
    typing: new Map(),  // roomId → Set<userId>  (who is currently typing)
}


// users
const registerSocket = (socketId, { userId, username, avatar = null }) => {
    store.sockets.set(socketId, { userId, username, avatar, onlineAt: Date.now() });
    store.userSockets.set(userId, socketId);
}


const removeSocket = (socketId) => {
    const user = store.sockets.get(socketId);
    if (user) {
        if (store.userSockets.get(user?.userId) === socketId) {
            store.userSockets.delete(user?.userId);
        }
        store.sockets.delete(socketId);
    }

    return user;
}

const getUserBySocket = (socketId) => {
    return store.sockets.get(socketId) || null;
}


const getUserById = (userId) => {
    const socketId = store.userSockets.get(userId);
    if (!socketId) return null;
    return store.sockets.get(socketId) || null;
}

const isUserOnline = (userId) => {
    return store.userSockets.has(userId);
}

const getOnlineUsers = () => {
    const users = [];
    store.userSockets.forEach((user, socketId) => {
        users.push({ ...user, socketId })
    })

    return users;
}


// rooms
const getOrCreateRoom = (roomId, name = null, creatorId) => {
    if (!store.rooms.has(roomId)) {
        store.rooms.set(roomId, {
            id: roomId,
            name: name || roomId,
            members: new Set(creatorId ? [creatorId] : []),
            createdAt: Date.now(),
        });
        store.messages.set(roomId, []);
        store.typing.set(roomId, new Set());
    }

    return store.rooms.get(roomId);
}

const joinRoom = (roomId, userId) => {
    const room = getOrCreateRoom(roomId);
    room?.members?.add(userId);
    return room;
}

const leaveRoom = (roomId, userId) => {
    const room = store.rooms.get(roomId);
    if (room) {
        room?.members?.delete(userId);
        const typingSet = store.typing.get(roomId);
        if (typingSet) {
            typingSet?.delete(userId);
        }
    }
}

const getRoomMembers = (roomId) => {
    const room = store.rooms.get(roomId);
    return room ? Array.from(room) : []
}


const addMessages = (roomId, { senderId, senderName, content, type = 'text', replyTo = null }) => {
    const messages = store.messages.get(roomId);
    if (!messages) return null;

    const msg = {
        id: uuidv4(),
        roomId,
        senderId,
        senderName,
        content,
        type,
        replyTo,
        status: 'sent',
        createdAt: Date.now(),
        deliveredTo: [],
        readBy: [],
    }

    messages.push(msg);
    return msg;
}


const updateMessageStatus = (roomId, messageId, userId, status) => {
    const messages = store.messages.get(roomId);

    if (!messages) return null;

    const msg = messages?.find(m => m?.id === messageId);
    if (!msg) return null;


    if (status === 'delivered' && !msg?.deliveredTo?.includes(userId)) {
        msg?.deliveredTo?.push(userId);
        if (msg?.status === 'sent') msg?.status = 'delivered';
    }


    if (status === 'read' && !msg?.readBy?.includes(userId)) {
        msg?.readBy?.push(userId);
        msg?.deliveredTo = [...new Set([...msg?.deliveredTo, userId])];
        msg?.status = 'read';
    }

    return msg;
}

const getMessages = (roomId, limit = 50) => {
    const messages = store?.message?.get(roomId) || [];
    return messages?.slice(-limit);
}



// typing


const setTyping = (roomId, userId, isTyping) => {
    if (!store.typing.has(roomId)) {
        store.typing.set(roomId, new Set());
    }

    const typingSet = store.typing.get(roomId);
    if (isTyping) {
        typingSet?.add(userId);
    } else {
        typingSet?.delete(userId);
    }

    return Array.from(typingSet);

}

const getTypingUsers = (roomId) => {
    return Array.from(store.typing.get(roomId) || []);
}


module.exports = {
    getRoomId,
    registerSocket,
    removeSocket,
    getUserBySocket,
    getUserById,
    isUserOnline,
    getOnlineUsers,
    getOrCreateRoom,
    joinRoom,
    leaveRoom,
    getRoomMembers,
    addMessages,
    updateMessageStatus,
    getMessages,
    setTyping,
    getTypingUsers,
}