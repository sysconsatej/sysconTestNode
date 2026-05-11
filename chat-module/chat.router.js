const express = require('express');
const router = express.Router();
const store = require("./store");
const fs = require("node:fs");
const path = require("node:path");
const { MAX_SIZE_BYTES, allowedFileExtensions, allowedFileTypes, buildDestination, buildFilename, fileUpload, saveFileToUploadFolder } = require("./uploadDocs");
const { count } = require('node:console');


router.get("/health", (req, res) => {
    res.json({ status: ok, uptime: process.uptime(), timeStamp: Date.now() })
});


// get users online 
router.get("/users/online", (req, res) => {
    const users = store.getOnlineUsers().map(u => ({
        userId: u?.userId,
        username: u?.username,
        avatar: u?.avatar,
        onlineAt: u?.onlineAt,
    }))

    res.json({ users, count: users?.length })
})


// status which user is online
router.get("/users/:userId/status", (req, res) => {
    const { userId } = req.params;
    const online = store.isUserOnline(userId);
    res.json({ userId, online });
})

router.get("/rooms/:roomId/messages", (req, res) => {
    const { roomId } = req.params;
    const limit = parseInt(req.query?.limit) || 50;
    const messages = store.getMessages(roomId, limit);
    res.json({ roomId, messages, count: messages.length });
})

router.get("/romms/:roomId/typing", (req, res) => {
    const { roomId } = req.params;
    const typingUsers = store.getTypingUsers(roomId);
    res.json({ roomId, typingUsers });
})

router.get("/rooms/:roomId/members", (req, res) => {
    const { roomId } = req.params;
    const members = store.getRoomMembers(roomId);
    const onlinMembers = members.filter(id => store.isUserOnline(id));
    res.json({ roomId, members, online: onlinMembers });
})


router.post("/upload", (req, res) => {

    try {
        const file = req.files?.file;
        if (!file) {
            return res.status(400).json({
                error: "No file received",
            })
        }


        const username = req.body?.username || req.query.username || "";
        if (!username) {
            return res.status(404).json({ error: "No username is provided" });
        }

        const info = await saveFileToUploadFolder({ filename: file, username: username })

        console.log(`${usename}  uploaded this ${file}`);

        res.status(200).json({
            ok: true,
            message: "File Uploaded successfully",
            status: res.statusCode,
        })

    } catch (err) {
        if (err?.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                error: "File exceeds more than 5MB limit."
            })
        }


        res.status(400).json({
            error: err.message || 'Upload failed.',
        });
    }

})


router.get("/upload/config", (req, res) => {
    res.json({
        maxSizeBytes: MAX_SIZE_BYTES,
        maxSizeMb: MAX_SIZE_BYTES / 1024 / 1024,
        allowedExtensions: Array.from(ALLOWED_EXTS),
        allowedLabel: 'PDF, DOCX, XLSX, CSV',
    })
})


router.get("/files/:username", (req, res) => {
    const safeUser = req.params.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(__dirname, "..", 'chat-docs-uploads', safeUser);
    if (!fs.existsSync(dir)) return res.json({ files: [] });

    const files = fs.readdirSync(dir).filter(f => !f.startsWith('.').map(f => {
        const stats = fs.statSync(path.join(dir, f));
        return {
            name: f,
            size: stats.size,
            sizeKb: Math.round(stats.size / 16),
            url: `/chat-docs-uploads/${safeUser}/${f}`,
            createdAt: stats.birthtime || stats.mtimeMs,
        }
    })).sort((a, b) => b?.createdAt - a?.createdAt);

    res.json({ username: req.params.username, files, count: files.length })

})

module.exports = router;