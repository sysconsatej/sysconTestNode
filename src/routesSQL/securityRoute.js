const express = require('express')
const router = express.Router()
const controller = require('../controllerSQL/securityController')

router.post('/decryptAndEncrypt', controller.decryptAndEncrypt)

module.exports = router
