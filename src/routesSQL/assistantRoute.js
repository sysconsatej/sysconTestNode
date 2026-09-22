const express = require("express");
const router = express.Router();
const auth = require("../config/auth");
const controller = require("../controllerSQL/assistantController");

// Artin assistant: per-user notes, reminders, and memory; push reminders; and
// the daily briefing summary. Mounted at /Sql/api/assistant.
router.get("/items", auth.verifyToken, controller.listItems);
router.post("/items/sync", auth.verifyToken, controller.syncItems);
router.get("/push/config", auth.verifyToken, controller.pushConfig);
router.post("/push/subscribe", auth.verifyToken, controller.subscribe);
router.post("/push/unsubscribe", auth.verifyToken, controller.unsubscribe);
router.post("/summary", auth.verifyToken, controller.summary);
router.get("/queries", auth.verifyToken, controller.queries);
router.post("/query", auth.verifyToken, controller.query);

module.exports = router;
