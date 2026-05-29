const getClientIp = req => {
    return (
        req.headers['x-forwarded-for']?.split(',').shift() || req?.socket?.remoteAddress || req?.ip
    )
}

module.exports = getClientIp;