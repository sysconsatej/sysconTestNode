const express = require("express");
const router = express.Router();
const activitiesService = require("../controllerSQL/activtiesController");
const auth = require("../config/auth");

router.post(
  "/getActivities",
  auth.verifyToken,
  activitiesService.getActivitiesList
);

router.post(
  "/getActivitiesStatus",
  auth.verifyToken,
  activitiesService.getActivitiesStatusesList
);

module.exports = router;
