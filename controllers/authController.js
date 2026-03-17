const User = require("../models/userModel");
const Otp = require("../models/otpModel");
const UserLog = require("../models/userLog"); 
const Session = require("../models/sessionModel"); 

// 🔥 NEW: Imported the Admin models to inject into existing flow
const Admin = require("../models/adminModel");
const AdminSession = require("../models/adminSession");
const AdminLog = require("../models/adminLog");

// 🔥 NEW: Import Notification model for login alerts
const Notification = require("../models/Notification");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const generateOtpEmail = require("../utils/otpEmailTemplate");
const failedLoginEmail = require("../utils/loginalertEmail");
const generateAuthEmail = require("../utils/forgotPassword");

// 🔥 NEW: Imported our reusable logger and device helper
const { logActivity, getDeviceInfo } = require("../utils/logger");

const OTP_EXPIRY = 5 * 60 * 1000;      // 5 minutes
const RESEND_COOLDOWN = 60 * 1000;    // 60 seconds

/* ================= MAIL TRANSPORT ================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ================= SEND OTP ================= */
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });

    const user = await User.findOne({ email });

    if (!user)
      return res.status(404).json({
        success: false,
        message: "User not found",
      });

    if (user.isEmailVerified)
      return res.status(409).json({
        success: false,
        message: "Email already verified",
      });

    const existingOtp = await Otp.findOne({ email });

    if (
      existingOtp &&
      Date.now() - existingOtp.createdAt < RESEND_COOLDOWN
    ) {
      return res.status(429).json({
        success: false,
        message: "Please wait before requesting another OTP",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: Date.now() },
      { upsert: true, new: true }
    );

    await transporter.sendMail({
      from: `"UBA Auth" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email",
      html: generateOtpEmail(otp),
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error("SEND OTP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
    });
  }
};

/* ================= VERIFY OTP ================= */
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp)
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });

    const record = await Otp.findOne({ email });
    if (!record)
      return res.status(400).json({
        success: false,
        message: "OTP not found",
      });

    if (Date.now() - record.createdAt > OTP_EXPIRY) {
      await Otp.deleteOne({ email });
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if (parseInt(otp) !== record.otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({
        success: false,
        message: "User not found",
      });

    user.isEmailVerified = true;
    await user.save();

    // 🔥 LOGGING (email added)
    await logActivity({
      userId: user._id,
      email: user.email,               // <-- ADDED
      action: "email_verification",
      category: "authentication",
      details: "User successfully verified their email address",
      req: req
    });

    await Otp.deleteOne({ email });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
    });
  }
};

/* ================= SIGN UP ================= */
exports.signUp = async (req, res) => {
  try {
    const { firstName, middleName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password)
      return res.status(400).json({ success: false, message: "All fields are required" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ success: false, message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      middleName,
      lastName,
      email,
      password: hashedPassword,
      role: "user", 
      isEmailVerified: false, 
    });

    // 🔥 LOGGING (email added)
    await logActivity({
      userId: user._id,
      email: user.email,               // <-- ADDED
      action: "account_creation",
      category: "authentication",
      details: "User registered a new account",
      req: req
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role, 
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res.status(500).json({ success: false, message: "Registration failed" });
  }
};

/* ================= LOGIN ================= */

exports.loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get device and location info (returns deviceName and locationString)
    const { deviceName, locationString } = await getDeviceInfo(req);

    // Extract IP address for notification data
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      'Unknown';

    // Construct the device info string exactly as used in sessions
    const deviceInfoString = `[Device: ${deviceName} | Location: ${locationString}]`;

    const user = await User.findOne({ email }).select("+password");
    if (!user) {

      // ==========================================
      // 🔥 NEW: INJECTED ADMIN LOGIN LOGIC 
      // Executed ONLY if the email is not found in the User table.
      // ==========================================
      const admin = await Admin.findOne({ email }).select("+password");
      if (admin) {
        const match = await bcrypt.compare(password, admin.password);
        if (!match) {
          await logActivity({
            adminId: admin._id,
            email: admin.email,               // <-- ADDED
            action: "login",
            category: "authentication",
            details: "Failed login attempt - Incorrect password ",
            status: "failed",
            req: req,
            role: "admin"
          });
          
          const failedLog = await AdminLog.findOne({ admin: admin._id, status: "failed" }).sort({ createdAt: -1 });
          const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
          const failedAttemptsCount = await AdminLog.countDocuments({
            admin: admin._id, action: "login", status: "failed", createdAt: { $gte: fifteenMinutesAgo }
          });

          if (failedAttemptsCount > 0 && failedAttemptsCount % 3 === 0) {
            try {
              await transporter.sendMail({
                from: `"UBA Security" <${process.env.EMAIL_USER}>`,
                to: admin.email,
                subject: "⚠️ Security Alert: Multiple Failed Login Attempts",
                html: failedLoginEmail(failedLog?._id || "Unknown"), 
              });
            } catch (mailErr) {}
          }
          return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const token = jwt.sign(
          { userId: admin._id, role: "admin" }, // Note: we use userId to prevent breaking existing middlewares
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );

        // 🔥 NEW: Check if this device+location is new for the admin
        const existingAdminSession = await AdminSession.findOne({
          admin: admin._id,
          deviceInfo: deviceInfoString,
        });

        if (!existingAdminSession) {
          await Notification.create({
            user: admin._id, // store admin _id in the same 'user' field
            type: 'new_login',
            title: 'New admin login detected',
            message: `New login from ${deviceName} in ${locationString}`,
            data: {
              device: deviceName,
              location: locationString,
              ip: ipAddress,
            },
          });
        }

        await logActivity({
          adminId: admin._id,
          email: admin.email,               // <-- ADDED
          action: "login",
          category: "authentication",
          details: "Admin logged in successfully ",
          req: req,
          role: "admin"
        });

        await AdminSession.findOneAndUpdate(
          { admin: admin._id, deviceInfo: deviceInfoString },
          { token: token, createdAt: Date.now() },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return res.status(200).json({
          success: true,
          message: "Login successful",
          token,
          user: {
            id: admin._id,
            firstName: admin.firstName,
            lastName: admin.lastName,
            email: admin.email,
            role: "admin", 
          },
        });
      }
      // ==========================================
      // END ADMIN LOGIC INJECTION 
      // ==========================================

      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      
      // 🔥 LOGGING (Failed) – email added
      await logActivity({
        userId: user._id,
        email: user.email,               // <-- ADDED
        action: "login",
        category: "authentication",
        details: "Failed login attempt - Incorrect password ",
        status: "failed",
        req: req
      });

      // Need to find the specific log ID for the email alert
      const failedLog = await UserLog.findOne({ user: user._id, status: "failed" }).sort({ createdAt: -1 });

      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const failedAttemptsCount = await UserLog.countDocuments({
        user: user._id,
        action: "login",
        status: "failed",
        createdAt: { $gte: fifteenMinutesAgo }
      });

      if (failedAttemptsCount > 0 && failedAttemptsCount % 3 === 0) {
        try {
          await transporter.sendMail({
            from: `"UBA Security" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: "⚠️ Security Alert: Multiple Failed Login Attempts",
            html: failedLoginEmail(failedLog._id), 
          });
          console.log(`Security alert email sent to ${user.email} for 3 failed attempts.`);
        } catch (mailErr) {
          console.error("Failed to send security alert email:", mailErr);
        }
      }
      
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role }, 
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 🔥 NEW: Check if this device+location is new for the user
    const existingSession = await Session.findOne({
      user: user._id,
      deviceInfo: deviceInfoString,
    });

    if (!existingSession) {
      await Notification.create({
        user: user._id,
        type: 'new_login',
        title: 'New login detected',
        message: `New login from ${deviceName} in ${locationString}`,
        data: {
          device: deviceName,
          location: locationString,
          ip: ipAddress,
        },
      });
    }

    // 🔥 LOGGING – email added
    await logActivity({
      userId: user._id,
      email: user.email,               // <-- ADDED
      action: "login",
      category: "authentication",
      details: "User logged in successfully ",
      req: req
    });

    // 🔥 SMART SESSION LOGIC: 
    // Uses findOneAndUpdate with upsert to ensure only ONE session exists per device.
    await Session.findOneAndUpdate(
      { 
        user: user._id, 
        deviceInfo: deviceInfoString 
      },
      { 
        token: token, 
        createdAt: Date.now() // Resets expiry
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role, 
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

/* ================= LOAD USER ================= */
exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      
      // ==========================================
      // 🔥 NEW: INJECTED ADMIN LOAD LOGIC
      // ==========================================
      const admin = await Admin.findById(req.user.userId).select("-password");
      if (admin) {
        return res.status(200).json({ success: true, user: admin });
      }
      // ==========================================

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("GET USER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load user",
    });
  }
};

/* ================= LOGOUT ================= */
exports.logoutUser = async (req, res) => {
  try {
    if (req.user && req.user.userId) {
      
      // ==========================================
      // 🔥 NEW: INJECTED ADMIN LOGOUT LOGIC
      // ==========================================
      if (req.user.role === "admin") {
        await logActivity({
          adminId: req.user.userId,
          email: req.user.email,               // <-- ADDED
          action: "logout",
          category: "authentication",
          details: "Admin logged out successfully ",
          status: "normal",
          req: req,
          role: "admin"
        });

        await AdminSession.deleteOne({
          admin: req.user.userId,
          token: req.token 
        });

        return res.status(200).json({
          success: true,
          message: "Logged out successfully",
        });
      }
      // ==========================================

      // 🔥 LOGGING – email added
      await logActivity({
        userId: req.user.userId,
        email: req.user.email,               // <-- ADDED
        action: "logout",
        category: "authentication",
        details: "User logged out successfully ",
        status: "normal",
        req: req
      });

      await Session.deleteOne({
        user: req.user.userId,
        token: req.token 
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    return res.status(200).json({
      success: true,
      message: "Logged out successfully (with logging error)",
    });
  }
};

/* ========================================================== */
/* NEW: FORGOT PASSWORD FLOW LOGIC              */
/* ========================================================== */

/* ================= REQUEST FORGOT PASSWORD OTP ================= */
exports.forgotPasswordSendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "No account found with that email address" });
    }

    const existingOtp = await Otp.findOne({ email });
    if (existingOtp && Date.now() - existingOtp.createdAt < RESEND_COOLDOWN) {
      return res.status(429).json({ success: false, message: "Please wait before requesting another OTP" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: Date.now() },
      { upsert: true, new: true }
    );

    await transporter.sendMail({
      from: `"UBA Auth" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request",
      html: generateAuthEmail("OTP", otp), 
    });

    return res.status(200).json({
      success: true,
      message: "Password reset OTP sent to email",
    });
  } catch (err) {
    console.error("FORGOT PASSWORD SEND OTP ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};

/* ================= VERIFY FORGOT PASSWORD OTP ================= */
exports.forgotPasswordVerifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    const record = await Otp.findOne({ email });
    if (!record) {
      return res.status(400).json({ success: false, message: "OTP not found or expired" });
    }

    if (Date.now() - record.createdAt > OTP_EXPIRY) {
      await Otp.deleteOne({ email });
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }

    if (parseInt(otp) !== record.otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    return res.status(200).json({ success: true, message: "OTP verified successfully. Proceed to reset password." });
  } catch (err) {
    console.error("FORGOT PASSWORD VERIFY OTP ERROR:", err);
    return res.status(500).json({ success: false, message: "OTP verification failed" });
  }
};

/* ================= RESET PASSWORD ================= */
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "Email, OTP, and new password are required" });
    }

    const record = await Otp.findOne({ email });
    if (!record || parseInt(otp) !== record.otp) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    // 🔥 LOGGING – email added
    await logActivity({
      userId: user._id,
      email: user.email,               // <-- ADDED
      action: "password_reset",
      category: "security",
      details: "User successfully reset their password via email OTP",
      req: req
    });

    await Otp.deleteOne({ email });

    await transporter.sendMail({
      from: `"UBA Auth" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Successful",
      html: generateAuthEmail("SUCCESS"), 
    });

    return res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to update password" });
  }
};

/* ================= CHANGE PASSWORD FOR LOGGED IN USER ================= */

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // ================= Fetch user with password =================
    const user = await User.findById(req.user.userId).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ================= Verify current password =================
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    // ================= Prevent using the same password =================
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({ message: "New password must be different from current password" });
    }

    // ================= Backend password strength validation =================
    const strongPasswordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&]).{8,}$/;
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({ message: "Password must be at least 8 characters and include a letter, number, and special character." });
    }

    // ================= Hash and save new password =================
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // ================= Logging without sensitive info =================
    const safeReq = { ...req, body: { ...req.body } }; 
    delete safeReq.body.currentPassword; 
    delete safeReq.body.newPassword;     

    await logActivity({
      userId: user._id,
      email: user.email,               // <-- ADDED
      action: "password_change",
      category: "security",
      details: "User successfully changed their password from settings",
      req: safeReq  // use safe request object
    });

    // ================= Success Response =================
    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//* ================= NOTIFICATIONS ================= *//

// Get unread notifications for the logged-in user (works for both user and admin)
exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      user: req.user.userId,
      read: false,
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Mark a single notification as read
exports.markAsRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.userId, read: false },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};