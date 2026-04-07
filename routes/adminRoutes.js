const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");

// Import your authentication middleware (assuming it exports 'protect')
const { auth } = require("../middleware/authMiddleware");
// Import the new role-based middleware
const roleMiddleware = require("../middleware/roleMiddleware");

// Apply protection to ALL admin routes in this file.
// This ensures the user is logged in (auth) AND has the admin role (roleMiddleware)
router.use(auth);
router.use(roleMiddleware("admin"));
 
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

module.exports = router;