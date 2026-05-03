const express = require("express");
const router = express.Router();
const { createLog, getLogs } = require("../controllers/ubaController");
const alertController = require("../controllers/alertController"); // Import the alert controller

// Import your authentication middleware (assuming it exports 'protect')
const { auth } = require("../middleware/authMiddleware");
// Import the new role-based middleware
const roleMiddleware = require("../middleware/roleMiddleware");

// 🔥 NEW: Import the specific limiter for high-frequency log ingestion
const { logIngestionLimiter } = require("../middleware/rateLimiter");

// Apply protection to ALL admin routes in this file.
// This ensures the user is logged in (auth) AND has the admin role (roleMiddleware)
router.use(auth);
router.use(roleMiddleware("admin"));
 
// ================= UBA LOG ROUTES =================
// 🔥 NEW: Applied logIngestionLimiter ONLY to this route for high throughput
router.post("/log", logIngestionLimiter, createLog);
router.get("/logs", getLogs); // Gets ALL raw logs

// ================= ALERT & ANOMALY ROUTES =================
// Gets formatted alerts for the dashboard
router.get("/alerts", alertController.getAlerts);

// Gets anomalies specifically for the review page
router.get("/alerts/anomalies", alertController.getAnomalies);

// Updates the status of an alert (e.g., open -> resolved)
router.put("/alerts/:id/status", alertController.updateAlertStatus);

module.exports = router;
