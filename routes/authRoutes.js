const express = require("express");
const {
  sendOtp,
  signUp,
  loginUser,
  logoutUser,
  getUserDetail,
  verifyOtp,
} = require("../controllers/authController");

const { auth } = require("../middleware/authMiddleware");

const router = express.Router();

/* ================= AUTH ROUTES ================= */

// OTP routes (public)
router.post("/sendotp", sendOtp);
router.post("/verifyotp", verifyOtp);

// Authentication routes (public)
router.post("/signup", signUp);
router.post("/login", loginUser);

// Logout route (protected & email must be verified)
router.post("/logout", auth, logoutUser);

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
