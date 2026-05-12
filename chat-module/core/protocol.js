const { v4: uuidV4 } = require('uuid');

// client -> server 
const C = {
    AUTH: 'auth',
    PING: 'ping',

    // rooms
    JOIN_ROOM: 'join_room',
    LEAVE_ROOM: 'leave_room',

    // messaging
    SEND_MESSAGE: 'send_message',
    SEND_DM: 'send_dm',
    GET_DM_HISTORY: 'get_dm_history',

    //status
    MESSAGE_DELIVERED: 'message_delivered',
    MESSAGE_READ: 'message_read',

    //typing
    TYPING_START: 'typing+_start',
    TYPING_STOP: 'typing_stop',
    DM_TYPING_START: 'dm_typing_start',
    DM_TYPING_STOP: 'dm_typing_stop',

    //calls
    INCOMING_CALL: 'incoming_call',
    CALL_ACCEPTED: 'call_accepted',
    CALL_REJECTED: 'call_rejected',
    CALL_OFFER: 'call_offer',
    CALL_ANSWER: 'call_answer',
    ICE_CANDIDATE: 'ice_candidate',
    END_CALL: 'end_call',
    // CALL_ENDED:'call_ended',
    // CALL_UNAVAILABLE:'call_unavailable',
}


const S = {
    AUTH_SUCCESS: 'auth_success',
    AUTH_ERROR: 'auth_error',
    PONG: 'pong',
    ERROR: 'error',

    ONLINE_USERS: 'online_users',
    USER_ONLINE: 'user_online',
    USER_OFFLINE: 'user_offline',

    ROOM_HISTORY: 'room_history',
    USER_JOINED_ROOM: 'user_joined_room',
    USER_LEFT_ROOM: 'user_left_room',

    NEW_MESSAGE: 'new_message',
    NEW_DM: 'new_dm',
    DM_HISTORY: 'dm_history',
    MESSAGE_STATUS: 'message_status',

    TYPING_UPDATE: 'typing_update',
    DM_TYPING_UPDATE: 'dm_typing_update',

    INCOMING_CALL: 'incoming_call',
    CALL_ACCEPTED: 'call_accepted',
    CALL_REJECTED: 'call_rejected',
    CALL_OFFER: 'call_offer',
    CALL_ANSWER: 'call_answer',
    ICE_CANDIDATE: 'ice_candidate',
    CALL_ENDED: 'call_ended',
    CALL_UNAVAILABLE: 'call_unavailable',
}


const frame = (type, payload = {}) => {
    return JSON.stringify({ id: uuidV4(), type, payload, ts: Date.now() })
}


const parse = (raw) => {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed?.type) throw new Error("Missing Type");
        return parsed;
    } catch (err) {
        throw new Error(err)
        return null;
    }
}


module.exports = { C, S, frame, parse }