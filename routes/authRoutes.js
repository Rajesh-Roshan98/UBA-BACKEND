const express = require("express");
const {
  sendOtp,
  signUp,
  loginUser,
  logoutUser,
  getUserDetail,
  verifyOtp,
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  resetPassword,
  changePassword,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  submitContactForm
} = require("../controllers/authController");

const { getProfile, updateProfile, uploadAvatar } = require("../controllers/profileController");

// --- NEW: Settings Controllers ---
const {
  getUserSettings,
  updateAccount,
  deleteAccount,
  getUserSessions,
  deleteSession,           // 🔥 NEW: Added import
  deleteAllOtherSessions   // 🔥 NEW: Added import
} = require("../controllers/settingsController");

const { auth } = require("../middleware/authMiddleware");

// 🔥 UPDATED: Renamed the middleware import to prevent a JavaScript naming collision
const { uploadAvatar: uploadAvatarMiddleware } = require('../middleware/uploadMiddleware');

const router = express.Router();

/* ================= AUTH ROUTES ================= */


router.get('/notifications', auth, getMyNotifications);
router.patch('/notifications/:id/read', auth, markAsRead);
router.post('/notifications/read-all', auth, markAllAsRead);

// OTP routes (public)
router.post("/sendotp", sendOtp);
router.post("/verifyotp", verifyOtp);
router.put("/change-password", auth, changePassword);
router.post('/contact', submitContactForm);

// Authentication routes (public)
router.post("/signup", signUp);
router.post("/login", loginUser);

// Logout route (protected & email must be verified)
router.post("/logout", auth, logoutUser);

router.get("/profile", auth, getProfile);
router.put("/profile", auth, updateProfile);

/* ================= FORGOT PASSWORD ROUTES ================= */

// Forgot Password flow (public)
router.post("/forgot-password/send-otp", forgotPasswordSendOtp);
router.post("/forgot-password/verify-otp", forgotPasswordVerifyOtp);
router.post("/forgot-password/reset", resetPassword);

/* ================= SETTINGS ROUTES ================= */

// Settings routes (protected)
router.get("/settings", auth, getUserSettings);
router.put("/settings/account", auth, updateAccount);
router.delete("/settings/account", auth, deleteAccount);

// Session routes
router.get("/settings/sessions", auth, getUserSessions);
router.delete("/settings/sessions", auth, deleteAllOtherSessions); // 🔥 NEW: Logout all other devices
router.delete("/settings/sessions/:sessionId", auth, deleteSession); // 🔥 NEW: Logout specific device

// 🔥 UPDATED: Applied the renamed middleware here before the controller executes
router.post("/profile/avatar", auth, uploadAvatarMiddleware.single('avatar'), uploadAvatar);

/* ================= USER ROUTES ================= */

// Load logged-in user from DB (protected & email must be verified)
router.get("/me", auth, (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

// Optional legacy route (protected & email must be verified)
router.get("/getUserDetail", auth, getUserDetail);

// Token validation route (protected & email must be verified)
router.get("/verify-token", auth, (req, res) => {
  res.status(200).json({
    success: true,
    valid: true,
    user: req.user,
  });
});

/* ================= TEST ROUTE ================= */

// Public test route
router.get("/test", (req, res) =>
  res.json({ success: true, msg: "Backend working!" })
);

module.exports = router;
 