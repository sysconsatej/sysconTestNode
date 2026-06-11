'use strict';

const { Router } = require('express');

const healthRoutes = require('./health');
const userRoutes   = require('./users');
const uploadRoutes = require('./upload');

/**
 * @param {import('../core/Store')}         store
 * @param {import('../core/WSServer')}       ws
 * @param {import('../services/UploadService')} uploadService
 */
module.exports = function mountRoutes(store, ws, uploadService) {
  const router = Router();

  router.use('/health', healthRoutes(store, ws));
  router.use('/users', userRoutes(store));
  router.use('/upload', uploadRoutes(uploadService));

  router.use('/rooms',   userRoutes(store));  
  router.use('/chat-files',   uploadRoutes(uploadService)); 

  return router;
};
