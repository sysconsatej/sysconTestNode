const express = require('express')
const router = express.Router()
const controller = require('../controllerSQL/EmailController')

router.post('/emailLogin', controller.EmailLogin)

module.exports = router
