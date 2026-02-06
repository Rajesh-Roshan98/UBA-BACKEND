const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

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

    // 🔍 Fetch fresh user data from DB
    const user = await User.findById(decoded.userId).select("-password");

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
      avatar: user.avatar || null,
      isEmailVerified: user.isEmailVerified,
    };

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
