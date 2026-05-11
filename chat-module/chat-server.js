require('dotenv').config();
const express = require('express');
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fileUpload = require('express-fileupload');

const routes = require("./chat.router");
const registerSocketHandler = require("./socketHandler");
const notifs = require("./notifications");

const PORT = process.env.CHAT_SERVER || 4235;
const PORT_HTTPS = process.env.PORT_HTTPS || 3443;
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY = process.env.SSL_KEY;


const app = express();
app.use(cors({ origin: "*", credentials: true }))
app.use(express.json());
// app.use(express.static(path.join(__dirname  ,  '')))
app.use(fileUpload({
    createParentPath: true,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    abortOnLimit: true,
}))

let primaryServer;

// if(SSL_CERT && SSL_KEY){
//     try  {  

//     } 
// }

