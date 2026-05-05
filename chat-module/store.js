const { v4: uuidv4 } = require('uuid')

const getRoomIs = (userIdA, userIdB) => {
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