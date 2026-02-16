const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { createLog, getLogs } = require("../controllers/ubaController"); 

// Middleware to protect routes (ensure user is logged in and is an Admin)
// Adjust the path to where your actual middleware is located
const { protect, authorize } = require("../middleware/authMiddleware");

// Apply protection to all admin routes
// router.use(protect);
// router.use(authorize("admin", "super_admin")); // Optional: restrict to specific roles

/* ================= DASHBOARD & STATS ================= */
// Route: GET /api/admin/stats
// Description: Returns aggregate stats for the dashboard (Users, Alerts, etc.)
router.get("/stats", adminController.getDashboardStats);

/* ================= USER MANAGEMENT ================= */
// Route: GET /api/admin/users
// Description: Returns list of all users with calculated Risk Scores
router.get("/users", adminController.getAllUsers);

// Route: PUT /api/admin/users/:id
// Description: Update a specific user's status (active/suspended) or role
router.put("/users/:id", adminController.updateUserStatus);

/* ================= ACCESS CONTROL ================= */
// Route: GET /api/admin/permissions
// Description: Get list of active access permissions
router.get("/permissions", adminController.getPermissions);

// Route: POST /api/admin/permissions
// Description: Grant new access permission to a user
router.post("/permissions", adminController.grantAccess);

router.get("/logs", getLogs);

module.exports = router;