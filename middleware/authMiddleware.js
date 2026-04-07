const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Session = require("../models/sessionModel"); // 🔥 NEW: Import the Session model

// 🔥 NEW: Import the Admin models
const Admin = require("../models/adminModel");
const AdminSession = require("../models/adminSession");

exports.auth = async (req, res, next) => { 
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token missing",
      });
    }

    const token = authHeader.split(" ")[1];

    // 🔐 Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN MIDDLEWARE LOGIC
    // Intercepts admins so they don't fail the User Session check below
    // ==========================================
    if (decoded.role === "admin") {
      // ✅ Added .lean() for performance
      const activeAdminSession = await AdminSession.findOne({ admin: decoded.userId, token: token }).lean();
      if (!activeAdminSession) {
        return res.status(401).json({
          success: false,
          message: "Admin session expired or logged out from another device",
        });
      }

      // ✅ Added .lean() for performance
      const admin = await Admin.findById(decoded.userId).select("-password").lean();
      if (!admin) {
        return res.status(401).json({
          success: false,
          message: "Admin no longer exists",
        });
      }

      // ✅ Attach Admin context exactly how downstream controllers expect it
      req.user = {
        userId: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        role: "admin", 
        avatar: admin.avatar || null,
        isEmailVerified: true, // Bypass user email verification logic for admins
      };
      
      req.token = token;
      return next(); // Move directly to the route, skipping the User block entirely
    }
    // ==========================================
    // END ADMIN LOGIC INJECTION 
    // ==========================================


    // 🔥 NEW: Check if this specific session still exists in the database
    // If you clicked "Logout" on another device, this will return null and block them!
    // ✅ Added .lean() for performance
    const activeSession = await Session.findOne({ user: decoded.userId, token: token }).lean();
    if (!activeSession) {
      return res.status(401).json({
        success: false,
        message: "Session expired or logged out from another device",
      });
    }

    // 🔍 Fetch fresh user data from DB
    // ✅ Added .lean() for performance
    const user = await User.findById(decoded.userId).select("-password").lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // ✅ Attach FULL user context
    req.user = {
      userId: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role, // <-- Added role here so roleMiddleware can read it
      avatar: user.avatar || null,
      isEmailVerified: user.isEmailVerified,
    };

    // <-- ADDED: Attach the exact token to the request for device-specific logout
    req.token = token;

    // 🔥 Only block unverified users for **sensitive routes**
    const PROTECTED_ROUTES = [
      "/api/v1/someProtectedRoute1",
      "/api/v1/someProtectedRoute2",
      // add all other protected routes here
    ];

    if (!user.isEmailVerified && PROTECTED_ROUTES.includes(req.path)) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email to access this resource",
      });
    }

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};