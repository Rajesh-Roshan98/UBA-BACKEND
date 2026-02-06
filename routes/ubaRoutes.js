const express = require("express");
const router = express.Router();
const { createLog, getLogs } = require("../controllers/ubaController");

router.post("/log", createLog);
router.get("/logs", getLogs);

module.exports = router;
