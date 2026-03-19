const express = require('express');
const router = express.Router();

// Import ALL Controllers from your combined userController file
const { 
  getDashboardOverview, 
  getAlerts, 
  resolveAlert, 
  getReports, 
  getUserLog,
  getFailedAttempts, 
  getPublicAlertDetails, 
  acknowledgePublicAlert,
  securePublicAccount // Updated to match your combined controller's function name
} = require('../controllers/userController');
const { auth } = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

router.get('/public-alert/details', getPublicAlertDetails);
router.post('/public-alert/:id/secure', securePublicAccount);
router.put('/public-alert/:id/acknowledge', acknowledgePublicAlert);

// Apply protection to ALL routes in this file.
// This ensures the user is logged in (auth) AND has the 'user' role (roleMiddleware), blocking admins.
router.use(auth);
router.use(roleMiddleware("user"));

// --- Dashboard Route ---
// GET /api/user/udashboard
router.get('/udashboard', getDashboardOverview);

// --- Alerts Routes ---
// GET /api/user/ualerts
router.get('/ualerts', getAlerts);

// PUT /api/user/ualerts/:id/resolve
router.put('/ualerts/:id/resolve', resolveAlert);

// --- Reports Route ---
// GET /api/user/ureports
router.get('/ureports', getReports);

// --- Activity Monitor Route ---
// GET /api/user/uactivity
router.get('/uactivity', getUserLog); 

router.get('/uactivity/failed', getFailedAttempts);

module.exports = router;