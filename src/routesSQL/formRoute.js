const express = require('express');
const router = express.Router();
const controller = require('../controllerSQL/formController')
const auth = require('../config/auth')

router.get('/list', auth.verifyToken, controller.listControlToDrawScreen)



module.exports = router