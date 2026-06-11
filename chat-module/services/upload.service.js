'use strict';

const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
]);


const ALLOWED_EXT = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv']);

const EXT_LABEL = {
    '.pdf': 'PDF',
    '.docx': 'Word',
    '.doc': 'Word',
    '.xlsx': 'Excel',
    '.xls': 'Excel',
    '.csv': 'CSV',
};

class UploadService {
    constructor(uploadsRoot) {
        this._root = uploadsRoot || path.join(__dirname, "..", '..', "chat-uploads");

        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                const username = req.body.username || req.query.username || 'unknown';
                const dir = this._userDir(username);
                fs.mkdirSync(dir, { recursive: true });
                cb(null, dir);
            },
            filename: (req, file, cb) => cb(null, this._buildFilename(file.originalname)),
        });

        const fileFilter = (req, file, cb) => {
            const mime = file.mimetype.toLowerCase();
            const ext = path.extname(file.originalname).toLowerCase();
            if (!ALLOWED_MIME.has(mime) && !ALLOWED_EXT.has(ext)) {
                return cb(Object.assign(
                    new Error('File type not allowed. Accepted: PDF, DOCX, XLSX, CSV (max 5 MB).'),
                    { code: 'INVALID_TYPE' }
                ), false);
            }
            cb(null, true);
        };

        this.multer = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } });


    }


    single() {
        return this.multer.single('file');
    }

    handleError(err, req, res, next) {
        if (!err) return next();
        if (err?.code === 'LIMIT_FILE_SIZE') return res?.status(413)?.json({ error: 'File Exceeds 5 Mb limit' });
        if (err?.code === 'INVALID_TYPE') return res?.status(415).json({ error: err?.message });
        return res?.status(400)?.json({ error: err?.message || 'Upload file .' });
    }

    fileInfo(file, username) {
        const safeUser = this._safeUserName(username);
        const ext = path.extname(file?.originalname).toLowerCase();
        return {
            originalName: file.originalname,
            storedName: file.filename,
            size: file.size,
            sizeKb: Math.round(file.size / 1024),
            mimeType: file.mimetype,
            label: EXT_LABEL[ext] || ext.replace('.', '').toUpperCase(),
            url: `/uploads/${safeUser}/${file.filename}`,
            uploadedAt: Date.now(),
        }
    }

    listFiles(username) {
        const dir = this._userDir(username);
        if (!fs.existsSync(dir)) return [];

        return fs.readdirSync(dir).filter(f => !f.startsWith('.')).map(f => {
            const stat = fs.statSync(path.join(dir, f));
            const ext = path.extname(f).toLowerCase();
            return {
                name: f,
                size: stat.size,
                sizeKb: Math.round(stat.size / 1024),
                label: EXT_LABEL[ext] || ext.replace('.', '').toUpperCase(),
                url: `/uploads/${this._safeUserName(username)}/${f}`,
                createdAt: stat.birthtimeMs || stat.mtimeMs,
            };
        }).sort((a, b) => b.createdAt - a.createdAt);
    }

    get config() {
        return {
            maxSizeBytes: MAX_SIZE_BYTES,
            maxSizeMb: MAX_SIZE_BYTES / 1024 / 1024,
            allowedExtensions: Array.from(ALLOWED_MIME),
            allowedLabel: 'PDF, DOCX, XLSX, CSV',
        }
    }


    _safeUserName(username) {
        return username?.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    _userDir(username) {
        return path.join(this._root, this._safeUserName(username));
    }

    _buildFilename(originalName) {
        const ext = path.extname(originalName).toLowerCase();
        const base = path.basename(originalName, ext)
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 80);
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
            + `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
        return `${base}_${stamp}${ext}`;
    }

}


module.exports = UploadService;
