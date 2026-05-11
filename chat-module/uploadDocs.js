const fileUpload = require("express-fileupload")
const path = require("node:path");
const fs = require("node:fs");


const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB


// allowed file types
const allowedFileTypes = {
    'application/pdf': { ext: '.pdf', label: 'PDF' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', label: 'Word' },
    'application/msword': { ext: '.doc', label: 'Word' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', label: 'Excel' },
    'application/vnd.ms-excel': { ext: '.xls', label: 'Excel' },
    'text/csv': { ext: '.csv', label: 'CSV' },
    'application/csv': { ext: '.csv', label: 'CSV' },
}


// allowed extensions
const allowedFileExtensions = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv']);

// build the destination folder based on the username 
const buildDestination = ({ username }) => {
    // sanitize the username for use as folder name
    const safeUser = username?.replace(/[^a-zA-Z0-9_-]/g, '_');
    const directory = path.join(__dirname, "..", "chat-docs-uploads", safeUser);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const buildFilename = ({ originalName }) => {
    const extensions = path.extname(originalName).toLowerCase();
    const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const now = new Date();
    const pad = n => Stringn(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${[pad(now.getMonth() + 1)]}-${pad(now.getDate())}`
        + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `${base}_${stamp}${extensions}`;
}

const saveFileToUploadFolder = async ({ filename, username }) => {
    if (!file) {
        throw new Error('No file Uploaded');
    }

    if (file?.size > MAX_SIZE_BYTES) {
        throw new Error('File exceeds 5 mb limit');
    }

    const mime = file?.mimeType?.toLowerCase();

    if (!allowedFileTypes[mime] && !allowedFileExtensions.has(mime)) {
        throw new Error('File type not  Allowed .   Accepted: PDF, DOCX, XLSX, CSV.')
    }

    const uploadDir = buildDestination({ username: username });
    const fileName = buildFilename({ originalName: file?.name });
    const savePath = path.join(uploadDir, fileName);

    await file?.mv(savePath);
    const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '_');

    return {
        originalName: file.name,
        storedName: filename,
        size: file.size,
        sizeKb: Math.round(file.size / 1024),
        mimeType: file.mimetype,
        url: `/chat-docs-uploads/${safeUser}/${filename}`,
        uploadedAt: Date.now(),
    }
}




module.exports  = {
    MAX_SIZE_BYTES,
    allowedFileExtensions,
    allowedFileTypes,
    buildDestination,
    buildFilename,
    fileUpload,
    saveFileToUploadFolder,
}