const User = require("../models/userModel");
const Session = require("../models/sessionModel"); // 🔥 NEW: Imported your Session model
const Admin = require("../models/adminModel"); // 🔥 NEW: Import Admin model
const AdminSession = require("../models/adminSession"); // 🔥 NEW: Import Admin Session model
const AdminLog = require("../models/adminLog");
const UserLog = require("../models/userLog");
const validator = require("validator");

// 🔥 NEW: Import the reusable logger
const { logActivity } = require("../utils/logger");

// @desc    Get user settings
// @route   GET /api/settings 
// @access  Private
exports.getUserSettings = async (req, res) => {
  try {
    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      const admin = await Admin.findById(req.user.userId).select('-password').lean(); 
      if (!admin) {
        return res.status(404).json({ message: 'Admin not found' });
      }
      return res.json({
        email: admin.email,
        fname: [admin.firstName, admin.middleName, admin.lastName].filter(Boolean).join(" "),      
        phone: admin.phone,
        avatarUrl: admin.avatar, 
        isEmailVerified: true // Admins bypass email verification
      });
    }
    // ==========================================

    const user = await User.findById(req.user.userId).select('-password').lean(); 
    
    if (!user) {
      console.log("❌ User not found in database!");
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      email: user.email,
      fname: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" "),      
      phone: user.phone,
      avatarUrl: user.avatar, 
      isEmailVerified: user.isEmailVerified
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update General Account Info (Name, Email, Phone)
// @route   PUT /api/settings/account
// @access  Private
exports.updateAccount = async (req, res) => {
  try {
    const { fname, email, phone } = req.body;
    const updateData = {};
    let emailChanged = false; // 🔥 Track if email was specifically changed

    // --- Validation ---
    if (email && !validator.isEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    if (phone && !validator.isMobilePhone(phone, "any")) {
      return res.status(400).json({ message: "Invalid phone number" });
    }
    
    // Safely split the React "fname" back into the DB's required firstName/lastName
    if (fname !== undefined) {
      const nameParts = fname.trim().split(/\s+/);
      updateData.firstName = nameParts[0] || '';
      if (nameParts.length > 1) {
        updateData.lastName = nameParts.slice(1).join(' ');
      } // preserve lastName if only first name provided
    }

    if (phone !== undefined) {
      updateData.phone = phone;
    }

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      if (email !== undefined) {
        const currentAdmin = await Admin.findById(req.user.userId).select('email');
        if (email !== currentAdmin.email) {
          updateData.email = email;
          emailChanged = true;
        } else {
          updateData.email = email;
        }
      }

      const updatedAdmin = await Admin.findByIdAndUpdate(
        req.user.userId,
        { $set: updateData }, 
        { new: true, runValidators: true, timestamps: { createdAt: false, updatedAt: true } }
      ).select('-password');

      let logDetailsMessage = "Admin updated their general account information";
      if (emailChanged) { logDetailsMessage = `Admin changed their email address to ${email}`; }

      await logActivity({
        adminId: req.user.userId,
        role: "admin",
        action: emailChanged ? "email_change" : "account_update", 
        category: "settings",
        details: logDetailsMessage,
        req: req
      });

      return res.json(updatedAdmin);
    }
    // ==========================================

    // Check if email is changing to reset verification status
    if (email !== undefined) {
      const currentUser = await User.findById(req.user.userId).select('email');
      if (email !== currentUser.email) {
        updateData.email = email;
        updateData.isEmailVerified = false;
        emailChanged = true; // 🔥 Mark that the email was actually changed
      } else {
        updateData.email = email;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updateData }, 
      { 
        new: true, 
        runValidators: true,
        // 🔥 THE FIX: Strictly command Mongoose to ignore createdAt during this update
        timestamps: { createdAt: false, updatedAt: true } 
      }
    ).select('-password');

    // 🔥 Make the log details dynamic!
    let logDetailsMessage = "User updated their general account information";
    if (emailChanged) {
      logDetailsMessage = `User changed their email address to ${email}`;
    }

    // 🔥 LOGGING
    await logActivity({
      userId: req.user.userId,
      action: emailChanged ? "email_change" : "account_update", // Change the action tag too!
      category: "settings",
      details: logDetailsMessage,
      req: req
    });

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete Account
// @route   DELETE /api/settings/account
// @access  Private
exports.deleteAccount = async (req, res) => {
  try {
    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      // Delete admin logs and sessions first
      await AdminLog.deleteMany({ admin: req.user.userId });
      await AdminSession.deleteMany({ admin: req.user.userId });
      
      // Then delete the admin
      await Admin.findByIdAndDelete(req.user.userId);
      
      // ❌ LOGGING REMOVED – no record of deletion is stored
      return res.json({ message: 'Admin account deleted successfully' });
    }
    // ==========================================

    // Delete user logs and sessions first
    await UserLog.deleteMany({ user: req.user.userId });
    await Session.deleteMany({ user: req.user.userId });
    
    // Then delete the user
    await User.findByIdAndDelete(req.user.userId);
    
    // ❌ LOGGING REMOVED – no record of deletion is stored

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get user sessions
// @route   GET /api/settings/sessions
// @access  Private
exports.getUserSessions = async (req, res) => {
  try {
    const userId = req.user.userId;

    let currentToken = null;
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      currentToken = req.headers.authorization.split(" ")[1];
    }
    
    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      const activeAdminSessions = await AdminSession.find({ admin: userId }).sort({ createdAt: -1 });
      const formattedAdminSessions = activeAdminSessions.map((session) => ({
        id: session._id,
        device: session.deviceInfo,
        ip: session.ipAddress,
        location: session.location, 
        lastActive: session.createdAt,
        current: session.token === currentToken 
      }));
      return res.status(200).json({ sessions: formattedAdminSessions });
    }
    // ==========================================

    // 🔥 UPDATED: Query the actual Session collection instead of the User document
    const activeSessions = await Session.find({ user: userId }).sort({ createdAt: -1 });

    // Format the database sessions to match what the React frontend expects
    const formattedSessions = activeSessions.map((session) => ({
      id: session._id,
      device: session.deviceInfo,
      ip: session.ipAddress,
      location: session.location, // 🔥 ADDED: Included location so Settings.jsx can render it
      lastActive: session.createdAt,
      current: session.token === currentToken // Highlights "Current" in UI if tokens match
    }));

    res.status(200).json({ sessions: formattedSessions });
  } catch (err) {
    console.error("Error fetching sessions:", err);
    res.status(500).json({ message: "Failed to fetch sessions" });
  }
};


// ==========================================
// 🔥 NEW SESSION LOGOUT LOGIC ADDED BELOW 🔥
// ==========================================

// @desc    Logout specific device/session
// @route   DELETE /api/settings/sessions/:sessionId
// @access  Private
exports.deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.userId;

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      const deletedAdminSession = await AdminSession.findOneAndDelete({ _id: sessionId, admin: userId });
      if (!deletedAdminSession) {
        return res.status(404).json({ message: "Admin session not found or already logged out" });
      }
      await logActivity({
        adminId: userId,
        role: "admin",
        action: "session_logout",
        category: "security",
        details: "Admin manually logged out of a specific device",
        req: req
      });
      return res.status(200).json({ message: "Admin device logged out successfully" });
    }
    // ==========================================

    // Delete the session ONLY if it belongs to the logged-in user
    const deletedSession = await Session.findOneAndDelete({ 
      _id: sessionId, 
      user: userId 
    });

    if (!deletedSession) {
      return res.status(404).json({ message: "Session not found or already logged out" });
    }

    // 🔥 LOGGING 
    await logActivity({
      userId: userId,
      action: "session_logout",
      category: "security",
      details: "User manually logged out of a specific device",
      req: req
    });

    res.status(200).json({ message: "Device logged out successfully" });
  } catch (error) {
    console.error("Error logging out session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// @desc    Logout ALL other devices/sessions
// @route   DELETE /api/settings/sessions
// @access  Private
exports.deleteAllOtherSessions = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get the token the user is using RIGHT NOW
    let currentToken = null;
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      currentToken = req.headers.authorization.split(" ")[1];
    }

    if (!currentToken) {
      return res.status(400).json({ message: "Could not identify current session" });
    }

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      await AdminSession.deleteMany({ admin: userId, token: { $ne: currentToken } });
      await logActivity({
        adminId: userId,
        role: "admin",
        action: "session_logout_all",
        category: "security",
        details: "Admin logged out of all other devices",
        req: req
      });
      return res.status(200).json({ message: "All other admin devices logged out successfully" });
    }
    // ==========================================

    // Delete all sessions for this user EXCEPT the one matching the current token
    await Session.deleteMany({ 
      user: userId, 
      token: { $ne: currentToken } 
    });

    // 🔥 LOGGING 
    await logActivity({
      userId: userId,
      action: "session_logout_all",
      category: "security",
      details: "User logged out of all other devices",
      req: req
    });

    res.status(200).json({ message: "All other devices logged out successfully" });
  } catch (error) {
    console.error("Error logging out other sessions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};