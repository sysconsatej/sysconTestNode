const express = require('express')
const router = express.Router()
const controller = require('../controllerSQL/notification.controller')

router.post('/notify', controller.notification)

module.exports = router
