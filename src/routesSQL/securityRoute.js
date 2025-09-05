const express = require('express')
const router = express.Router()
const controller = require('../controllerSQL/securityController')

router.post('/encrypt', controller.encrypt)

module.exports = router
