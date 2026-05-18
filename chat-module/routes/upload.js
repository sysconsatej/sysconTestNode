'use strict';

const { Router } = require('express');

/**
 * @param {import('../services/upload.service')} uploadService
 */
module.exports = function uploadRoutes(uploadService) {
  const router = Router();

  router.get('/config', (req, res) => {
    res.json(uploadService.config);
  });

  router.post(
    '/',
    uploadService.single(),
    uploadService.handleError,
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file received.' });
      }
      const username = req.body.username || req.query.username || 'unknown';
      const info = uploadService.fileInfo(req.file, username);
      console.log(`[Upload] 📎 ${username} → ${info.storedName} (${info.sizeKb} KB)`);
      res.json({ ok: true, file: info });
    }
  );

  router.get('/files/:username', (req, res) => {
    const { username } = req.params;
    const files = uploadService.listFiles(username);
    res.json({ username, files, count: files.length });
  });

  return router;
};