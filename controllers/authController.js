const User = require("../models/userModel");
const Otp = require("../models/otpModel");
const UserLog = require("../models/userLog"); 
const Session = require("../models/sessionModel"); 
const Contact = require("../models/contact");
const ContactEmail = require("../utils/contactEmail"); // Adjust path if needed

// 🔥 NEW: Imported the Admin models to inject into existing flow
const Admin = require("../models/adminModel");
const AdminSession = require("../models/adminSession");
const AdminLog = require("../models/adminLog");

// 🔥 NEW: Import Notification model for login alerts
const Notification = require("../models/Notification");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto"); // 🔥 NEW: Imported crypto to generate unique device IDs
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

    // 🔥 OPTIMIZED: Added .select() so we only fetch what we need to check verification
    const user = await User.findOne({ email }).select("isEmailVerified").lean();

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

    // 🔥 OPTIMIZED: Added .select() to only get the timestamp
    const existingOtp = await Otp.findOne({ email }).select("createdAt").lean();

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

    // 🔥 OPTIMIZED: Added .select() to avoid fetching heavy MongoDB metadata
    const record = await Otp.findOne({ email }).select("otp createdAt").lean();
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

    // ⚠️ NO LEAN HERE: We need the full Mongoose object to call user.save() below
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

    // 🔥 THE FIX: Upgraded to .exists() per teacher's advice
    const exists = await User.exists({ email });
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

    // 🔥 NEW: Check for device cookie to bypass unnecessary notifications
    const deviceCookie = req.cookies ? req.cookies.deviceId : undefined;
    const deviceId = deviceCookie || crypto.randomUUID();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    // Get device and location info
    const { deviceName, locationString } = await getDeviceInfo(req);

    // Extract IP address for notification data
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      'Unknown';

    // Construct the device info string exactly as used in sessions
    const deviceInfoString = `[Device: ${deviceName} | Location: ${locationString}]`;

    // ✅ OPTIMIZED: Added .lean()
    const user = await User.findOne({ email }).select("+password").lean();
    if (!user) {

      // ==========================================
      // 🔥 NEW: INJECTED ADMIN LOGIN LOGIC 
      // Executed ONLY if the email is not found in the User table.
      // ==========================================
      // ✅ OPTIMIZED: Added .lean()
      const admin = await Admin.findOne({ email }).select("+password").lean();
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
          
          // Left this as findOne to allow sorting for the exact email link
          const failedLog = await AdminLog.findOne({ admin: admin._id, status: "failed" }).sort({ createdAt: -1 }).select("_id").lean();
          const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
          
          // 🔥 THE FIX: Already perfectly using .countDocuments() here!
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
          { userId: admin._id, role: "admin" }, 
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );

        // Check if this device+location is new for the admin
        // 🔥 THE FIX: Upgraded to .exists()
        const existingAdminSession = await AdminSession.exists({
          admin: admin._id,
          deviceInfo: deviceInfoString,
        });

        // 🔥 UBA FIX: Database Memory Retrieval
        // 🔥 THE FIX: Upgraded to .exists()
        const knownAdminDevice = await AdminLog.exists({
          admin: admin._id,
          action: "login",
          device: deviceName,
          $or: [{ location: locationString }, { location: "Unknown" }], 
          status: "success" 
        });

        // 🔥 MODIFIED: Only fire Notification if NO cookie, NO active session, AND NO historical login
        if (!deviceCookie && !existingAdminSession && !knownAdminDevice) {
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

        // 🔥 FIX: ADDED location, ipAddress, and email TO ADMIN SESSION
        await AdminSession.findOneAndUpdate(
          { admin: admin._id, deviceInfo: deviceInfoString },
          { 
            token: token, 
            createdAt: Date.now(),
            location: locationString, 
            ipAddress: ipAddress,     
            email: admin.email        
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 🔥 FIX: Dynamic cookie options
        res.cookie('deviceId', deviceId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: thirtyDays,
        });

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
      
      // 🔥 LOGGING (Failed)
      await logActivity({
        userId: user._id,
        email: user.email,               
        action: "login",
        category: "authentication",
        details: "Failed login attempt - Incorrect password ",
        status: "failed",
        req: req
      });

      // Left this as findOne to allow sorting for the exact email link
      const failedLog = await UserLog.findOne({ user: user._id, status: "failed" }).sort({ createdAt: -1 }).select("_id").lean();

      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      
      // 🔥 THE FIX: Already using countDocuments() perfectly!
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

    // Check if this device+location is new for the user
    // 🔥 THE FIX: Upgraded to .exists()
    const existingSession = await Session.exists({
      user: user._id,
      deviceInfo: deviceInfoString,
    });

    // 🔥 UBA FIX: Database Memory Retrieval
    // 🔥 THE FIX: Upgraded to .exists()
    const knownUserDevice = await UserLog.exists({
      user: user._id,
      action: "login",
      device: deviceName,
      $or: [{ location: locationString }, { location: "Unknown" }], 
      status: "success"
    });

    // 🔥 MODIFIED: Only fire Notification if NO cookie, NO active session, AND NO historical login
    if (!deviceCookie && !existingSession && !knownUserDevice) {
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

    // 🔥 LOGGING 
    await logActivity({
      userId: user._id,
      email: user.email,               
      action: "login",
      category: "authentication",
      details: "User logged in successfully ",
      req: req
    });

    // 🔥 FIX: ADDED location, ipAddress, and email TO USER SESSION
    await Session.findOneAndUpdate(
      { 
        user: user._id, 
        deviceInfo: deviceInfoString 
      },
      { 
        token: token, 
        createdAt: Date.now(), 
        location: locationString, 
        ipAddress: ipAddress,     
        email: user.email         
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true 
      }
    );

    // 🔥 FIX: Dynamic cookie options
    res.cookie('deviceId', deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: thirtyDays,
    });

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
    // ✅ OPTIMIZED: Added .lean()
    const user = await User.findById(req.user.userId).select("-password").lean();
    if (!user) {
      
      // ==========================================
      // 🔥 NEW: INJECTED ADMIN LOAD LOGIC
      // ==========================================
      // ✅ OPTIMIZED: Added .lean()
      const admin = await Admin.findById(req.user.userId).select("-password").lean();
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

    // 🔥 FIX: Check User first, then Admin
    // 🔥 THE FIX: Upgraded to .exists()
    let account = await User.exists({ email });
    if (!account) {
      account = await Admin.exists({ email });
    }

    if (!account) {
      return res.status(404).json({ success: false, message: "No account found with that email address" });
    }

    // 🔥 OPTIMIZED: Added .select("createdAt")
    const existingOtp = await Otp.findOne({ email }).select("createdAt").lean();
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

    // 🔥 OPTIMIZED: Added .select("otp createdAt")
    const record = await Otp.findOne({ email }).select("otp createdAt").lean();
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

    // 🔥 OPTIMIZED: Added .select("otp")
    const record = await Otp.findOne({ email }).select("otp").lean();
    if (!record || parseInt(otp) !== record.otp) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    // 🔥 FIX: Find the account in either collection
    // ⚠️ NO LEAN HERE: We need the full Mongoose object to call account.save() below
    let account = await User.findOne({ email });
    let role = "user";

    if (!account) {
      account = await Admin.findOne({ email });
      role = "admin";
    }

    if (!account) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    account.password = hashedPassword;
    await account.save();

    // 🔥 FIX: Adjusted logging to handle Admin vs User IDs properly
    const logData = {
      email: account.email, 
      action: "password_reset",
      category: "security",
      details: `${role === 'admin' ? 'Admin' : 'User'} successfully reset their password via email OTP`,
      req: req,
      role: role
    };

    if (role === 'admin') {
      logData.adminId = account._id;
    } else {
      logData.userId = account._id;
    }

    await logActivity(logData);

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

    // 🔥 FIX: Fetch user or admin with password
    // ⚠️ NO LEAN HERE: We need the full Mongoose object to call account.save() below
    let account = await User.findById(req.user.userId).select("+password");
    let role = "user";

    if (!account) {
      account = await Admin.findById(req.user.userId).select("+password");
      role = "admin";
    }

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    // ================= Verify current password =================
    const match = await bcrypt.compare(currentPassword, account.password);
    if (!match) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    // ================= Prevent using the same password =================
    const isSame = await bcrypt.compare(newPassword, account.password);
    if (isSame) {
      return res.status(400).json({ message: "New password must be different from current password" });
    } 

    // ================= Backend password strength validation =================
    const strongPasswordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&]).{8,}$/;
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({ message: "Password must be at least 8 characters and include a letter, number, and special character." });
    }

    // ================= Hash and save new password =================
    account.password = await bcrypt.hash(newPassword, 10);
    await account.save();

    // ================= Logging without sensitive info =================
    const safeReq = { ...req, body: { ...req.body } }; 
    delete safeReq.body.currentPassword; 
    delete safeReq.body.newPassword;     

    // 🔥 FIX: Adjusted logging for Change Password
    const logData = {
      email: account.email, 
      action: "password_change",
      category: "security",
      details: `${role === 'admin' ? 'Admin' : 'User'} successfully changed their password from settings`,
      req: safeReq,
      role: role
    };

    if (role === 'admin') {
      logData.adminId = account._id;
    } else {
      logData.userId = account._id;
    }

    await logActivity(logData);

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
    // ✅ OPTIMIZED: Added .lean()
    const notifications = await Notification.find({
      user: req.user.userId,
      read: false,
    }).sort({ createdAt: -1 }).lean();
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

//* ================= CONTACT FORM SUBMISSION ================= *//

exports.submitContactForm = async (req, res) => {
  try {
    const { name, email, message } = req.body;

    // 1. Backend validation
    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // 2. Save to database
    const newContactMessage = new Contact({
      name,
      email,
      message,
    });

    await newContactMessage.save();

    // 3. Set up Nodemailer Transporter
    // Make sure to add EMAIL_USER and EMAIL_PASS to your .env file
    const transporter = nodemailer.createTransport({
      service: 'gmail', // You can change this to 'smtp.mailtrap.io', 'sendgrid', etc.
      auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS, // If using Gmail, use an App Password here
      },
    });

    // 4. Configure the Email Options
    const mailOptions = {
      from: process.env.EMAIL_USER, // The authenticated email address
      to: process.env.EMAIL_USER,   // <-- UPDATED: Now sends directly to your EMAIL_USER account
      subject: `New Contact Form Submission from ${name}`,
      html: ContactEmail(name, email, message),
      replyTo: email // Allows you to hit "Reply" and email the user directly
    };

    // 5. Send the Email
    // We don't await this directly so it doesn't block the response to the user.
    // We'll let it run in the background and just log if it fails.
    transporter.sendMail(mailOptions).catch(err => {
      console.error('Failed to send admin notification email:', err);
    });

    // 6. Success response to frontend
    res.status(201).json({
      success: true,
      message: 'Message sent successfully!',
      data: newContactMessage,
    });

  } catch (error) {
    console.error('Contact Form Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send message. Please try again later.' 
    });
  }
};

/* ========================================================== */
/* NEW: PUBLIC EMAIL ALERT ROUTES (USER & ADMIN)              */
/* ========================================================== */

exports.getPublicAlertDetails = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ message: "Alert ID missing" });

    // 1. Check UserLog first
    let log = await UserLog.findById(id)
      .select("user device location createdAt details")
      .populate("user", "firstName lastName email")
      .lean();

    let role = "user";

    // 2. If not found, check AdminLog
    if (!log) {
      log = await AdminLog.findById(id)
        .select("admin device location createdAt details")
        .populate("admin", "firstName lastName email")
        .lean();
      role = "admin";
    }

    // 3. Now throw the 404 if it's in NEITHER collection
    if (!log) return res.status(404).json({ message: "Security log not found" });

    // Normalize the account object so the frontend gets the exact same data structure
    const account = role === "admin" ? log.admin : log.user;

    res.status(200).json({
      name: account ? `${account.firstName} ${account.lastName}` : "Unknown User",
      email: account ? account.email : "Protected",
      device: log.device || "Unknown Device", 
      location: log.location || "Unknown Location",
      time: log.createdAt,
      reason: log.details || "Multiple Failed Logins"
    });
  } catch (error) {
    console.error("Public Alert Details Error:", error);
    res.status(500).json({ message: "Server error fetching alert" });
  }
};

exports.acknowledgePublicAlert = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Attempt to update UserLog first
    let updated = await UserLog.findByIdAndUpdate(id, { status: "acknowledged" });
    
    // If it wasn't a UserLog, update AdminLog
    if (!updated) {
      updated = await AdminLog.findByIdAndUpdate(id, { status: "acknowledged" });
    }

    if (!updated) return res.status(404).json({ message: "Alert not found" });
    
    res.status(200).json({ message: "Activity acknowledged successfully" });
  } catch (error) {
    console.error("Public Alert Acknowledge Error:", error);
    res.status(500).json({ message: "Server error acknowledging alert" });
  }
};

exports.securePublicAccount = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check UserLog
    const userLog = await UserLog.findById(id).select("user").lean();
    if (userLog && userLog.user) {
       await Session.deleteMany({ user: userLog.user });
       return res.status(200).json({ message: "User account secured successfully" });
    }
    
    // Check AdminLog
    const adminLog = await AdminLog.findById(id).select("admin").lean();
    if (adminLog && adminLog.admin) {
       await AdminSession.deleteMany({ admin: adminLog.admin });
       return res.status(200).json({ message: "Admin account secured successfully" });
    }
    
    res.status(404).json({ message: "Account/Log not found to secure" });
  } catch (error) {
    console.error("Public Alert Secure Error:", error);
    res.status(500).json({ message: "Server error securing account" });
  }
};