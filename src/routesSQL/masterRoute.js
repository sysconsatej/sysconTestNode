const controller = require('../controllerSQL/masterController')
const express = require('express')
const router = express.Router()
const auth = require('../config/auth')

router.post("/dytablelist", auth.verifyToken, controller.DisPlaySeacrchApi)



module.exports = router