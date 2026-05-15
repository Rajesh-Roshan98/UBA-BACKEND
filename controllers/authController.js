const User = require("../models/userModel");
const Otp = require("../models/otpModel");
const UserLog = require("../models/userLog"); 
const Session = require("../models/sessionModel"); 
const Contact = require("../models/contact");
const ContactEmail = require("../utils/contactEmail");

// 🔥 NEW: Imported the Admin models to inject into existing flow
const Admin = require("../models/adminModel");
const AdminSession = require("../models/adminSession");
const AdminLog = require("../models/adminLog");

// 🔥 NEW: Import Notification model for login alerts
const Notification = require("../models/Notification");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const crypto = require("crypto"); 
const generateOtpEmail = require("../utils/otpEmailTemplate");
const failedLoginEmail = require("../utils/loginalertEmail");
const generateAuthEmail = require("../utils/forgotPassword");

// 🔥 NEW: Imported our reusable logger and device helper
const { logActivity, getDeviceInfo } = require("../utils/logger");
const validator = require("validator"); // 🔥 NEW: Ensure validator is available

// 🔥 NEW: Import our Socket helper to emit real-time notifications
const { emitToUser } = require("../utils/socketConfig"); 

// 🔥 FIX: Generate a valid dummy hash once at startup to safely prevent timing attacks
const DUMMY_HASH = bcrypt.hashSync("dummy_password", 10);

// 🔥 SECURITY FIX: Temporary in-memory store to prevent CAPTCHA replay attacks
const usedCaptchaNonces = new Set();

// ==========================================================
// 🔥 UPGRADED: SECURE CAPTCHA UTILITIES
// ==========================================================
const svgCaptcha = require("svg-captcha");
const rateLimit = require("express-rate-limit");

// 1. Rate Limiting Middleware (10 requests per minute)
const captchaLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 10, 
  message: { success: false, message: "Too many CAPTCHA requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. Generate Secure SVG CAPTCHA Data
const generateCaptchaData = () => {
  const SECRET = process.env.CAPTCHA_SECRET;
  if (!SECRET) throw new Error("CAPTCHA_SECRET not set in environment variables");

  // Create an SVG image (Bots can't read this easily)
  const captcha = svgCaptcha.create({
    size: 6,
    noise: 2, // Adds lines/dots to confuse OCR bots
    color: true,
    background: '#f4f4f5'
  });

  // 🔥 FIX: Reverted to strict case-sensitive CAPTCHA
  const captchaText = captcha.text; 
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiry
  const nonce = crypto.randomBytes(8).toString('hex'); // Unique random string to prevent replay attacks
  
  // Create a stateless hash including the nonce and strict secret
  const dataToHash = `${captchaText}.${expires}.${nonce}.${SECRET}`;
  const hash = crypto.createHash('sha256').update(dataToHash).digest('hex');
  
  return { 
    captchaImage: captcha.data, // Send SVG image, NOT text
    captchaToken: `${hash}.${expires}.${nonce}` 
  };
};

// 🔥 UPDATED: Endpoint to fetch CAPTCHA (Wrapped in Rate Limiter)
exports.getCaptcha = [
  captchaLimiter,
  (req, res) => {
    try {
      res.status(200).json({ 
        success: true, 
        ...generateCaptchaData() 
      });
    } catch (error) {
      console.error(`[🚨 CAPTCHA GENERATION ERROR] Failed to create CAPTCHA: ${error.message}`, error);
      res.status(500).json({ success: false, message: "Failed to generate CAPTCHA. Check server configuration." });
    }
  }
];
// ==========================================================

// 🔥 UPDATED: Helper to generate 8-char ID (4 NON-REPEATING letters + 4 random numbers)
const generateUserId = (fullName) => {
  // 1. Strip spaces/symbols and convert to uppercase
  let cleanName = (fullName || "USER").replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (cleanName.length === 0) cleanName = "USER"; 

  // 2. Extract only UNIQUE letters from the name so we never have a pool with duplicates
  let uniqueLetters = [...new Set(cleanName.split(''))];

  // 3. Fallback: If the name has fewer than 4 unique letters (e.g., "Bob" -> "B", "O")
  // we pad the pool with random unused letters from the alphabet until we have 4 options.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
  while (uniqueLetters.length < 4) {
    const randomChar = alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!uniqueLetters.includes(randomChar)) {
      uniqueLetters.push(randomChar);
    }
  }

  // 4. Pick exactly 4 random, unique letters from our pool
  let randomLetters = "";
  for (let i = 0; i < 4; i++) {
    const randomIndex = Math.floor(Math.random() * uniqueLetters.length);
    randomLetters += uniqueLetters[randomIndex];
    // Remove the selected letter so it is impossible to pick it again
    uniqueLetters.splice(randomIndex, 1);
  }

  // 5. Generate exactly 4 random numbers
  let randomNums = "";
  for (let i = 0; i < 4; i++) {
    randomNums += Math.floor(Math.random() * 10).toString();
  }

  // 6. Combine them to enforce the strict 8-character length (4 letters + 4 numbers)
  return randomLetters + randomNums;
};

const OTP_EXPIRY = 5 * 60 * 1000;      // 5 minutes
const RESEND_COOLDOWN = 60 * 1000;    // 60 seconds

/* ================= MAIL TRANSPORT ================= */
// 🔥 UPGRADED: Scalable Brevo SMTP Configuration
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // true for 465, false for other ports
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

    // 🔥 SECURITY FIX: Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 🔥 INDUSTRY STANDARD: Validate email format before hitting the DB
    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    const user = await User.findOne({ email: normalizedEmail }).select("isEmailVerified").lean();

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

    const existingOtp = await Otp.findOne({ email: normalizedEmail }).select("createdAt").lean();

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
    
    // 🔥 SECURITY FIX: Hash the OTP before saving to database
    const hashedOtp = await bcrypt.hash(otp.toString(), 10);

    // 🔥 FIX: Reset attempts to 0 when generating a new OTP
    await Otp.findOneAndUpdate(
      { email: normalizedEmail },
      { email: normalizedEmail, otp: hashedOtp, attempts: 0, createdAt: Date.now() },
      { upsert: true, new: true }
    );

    // 🔥 FIRE AND FORGET: Removed await & Updated with Dynamic Env Variables
    transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: normalizedEmail,
      subject: `Verify Your ${process.env.APP_NAME} Account`,
      html: generateOtpEmail(otp), // Send the unhashed OTP to the user's email
    })
    .then(() => console.log(`[✉️ EMAIL SUCCESS] Verification OTP sent to ${normalizedEmail}`))
    .catch((mailErr) => console.error(`[⚠️ EMAIL ERROR] Failed to send verification OTP to ${normalizedEmail}: ${mailErr.message}`, mailErr));

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.error(`[🚨 SEND OTP ERROR] Failed to send verification OTP: ${err.message}`, err);
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

    const normalizedEmail = email.trim().toLowerCase();

    // 🔥 SECURITY FIX: Added 'attempts' to the select query
    const record = await Otp.findOne({ email: normalizedEmail }).select("otp createdAt attempts").lean();
    if (!record)
      return res.status(400).json({
        success: false,
        message: "OTP not found",
      });

    // 🔥 SECURITY FIX: Stop OTP brute-forcing
    if (record.attempts >= 5) {
      await Otp.deleteOne({ email: normalizedEmail });
      return res.status(429).json({ success: false, message: "Too many invalid OTP attempts. Please request a new one." });
    }

    if (Date.now() - record.createdAt > OTP_EXPIRY) {
      await Otp.deleteOne({ email: normalizedEmail });
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // 🔥 SECURITY FIX: Compare incoming OTP with hashed OTP in database
    const isMatch = await bcrypt.compare(otp.toString(), record.otp);
    if (!isMatch) {
      // 🔥 SECURITY FIX: Increment failed attempt counter
      await Otp.updateOne({ email: normalizedEmail }, { $inc: { attempts: 1 } });
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user)
      return res.status(404).json({
        success: false,
        message: "User not found",
      });

    user.isEmailVerified = true;
    await user.save();

    await logActivity({
      userId: user._id,
      email: user.email,                
      action: "email_verification",
      category: "authentication",
      details: "User successfully verified their email address",
      req: req
    });

    await Otp.deleteOne({ email: normalizedEmail });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    console.error(`[🚨 VERIFY OTP ERROR] Failed during email OTP verification: ${err.message}`, err);
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

    // 🔥 INDUSTRY STANDARD: Name & Email Validation
    const normalizedEmail = email.trim().toLowerCase();
    
    if (firstName.trim().length < 2 || firstName.trim().length > 50) {
      return res.status(400).json({ success: false, message: "First name must be between 2 and 50 characters" });
    }

    // 🔥 SECURITY FIX: Strict Name Validation (Blocks symbols and numbers)
    const nameRegex = /^[A-Za-z\s'-]+$/;
    if (!nameRegex.test(firstName.trim()) || (lastName && !nameRegex.test(lastName.trim()))) {
       return res.status(400).json({ success: false, message: "Names can only contain letters, spaces, hyphens, and apostrophes" });
    }

    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    // 🔥 SECURITY FIX: Enforce strong passwords on signup (Upper, Lower, Number, Special, 8-64 chars)
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&]).{8,64}$/;
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({ success: false, message: "Password must be 8-64 characters and include an uppercase letter, lowercase letter, number, and special character." });
    }

    const exists = await User.exists({ email: normalizedEmail });
    if (exists) return res.status(409).json({ success: false, message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 🔥 SECURITY FIX: ID Collision Loop - Added attempts limit to prevent infinite loops
    let generatedUserId;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
      generatedUserId = generateUserId(`${firstName} ${middleName || ""} ${lastName}`);
      const idExists = await User.exists({ userId: generatedUserId });
      if (!idExists) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({ success: false, message: "Server error generating unique ID. Please try again." });
    }

    const user = await User.create({
      userId: generatedUserId, 
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : "",
      lastName: lastName.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "user", 
      isEmailVerified: false, 
    });

    await logActivity({
      userId: user._id,
      email: user.email,                
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
        userId: user.userId, 
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role, 
        isEmailVerified: user.isEmailVerified,
      },
    });
  } catch (err) {
    console.error(`[🚨 SIGNUP ERROR] Failed to create new user account: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "Registration failed" });
  }
};

/* ================= LOGIN ================= */

exports.loginUser = async (req, res) => {
  try {
    const { email, identifier, password, captchaInput, captchaToken } = req.body;
    
    // ==========================================================
    // 🔥 UPGRADED: SECURE CAPTCHA VALIDATION
    // ==========================================================
    if (!captchaInput || !captchaToken) {
      return res.status(400).json({ 
        success: false, 
        message: "CAPTCHA is required.", 
        newCaptcha: generateCaptchaData() 
      });
    }

    const [hash, expires, nonce] = captchaToken.split('.'); // Extract the nonce
    if (!hash || !expires || !nonce || Date.now() > parseInt(expires, 10)) {
      return res.status(400).json({ 
        success: false, 
        message: "CAPTCHA expired or invalid. Please try again.", 
        newCaptcha: generateCaptchaData() 
      });
    }

    // 🔥 SECURITY FIX: Check if CAPTCHA nonce was already used (Replay Attack Prevention)
    if (usedCaptchaNonces.has(nonce)) {
      return res.status(400).json({ 
        success: false, 
        message: "CAPTCHA already used. Please request a new one.", 
        newCaptcha: generateCaptchaData() 
      });
    }

    const SECRET = process.env.CAPTCHA_SECRET;
    if (!SECRET) {
      return res.status(500).json({ success: false, message: "Server misconfiguration. CAPTCHA_SECRET missing." });
    }

    // 🔥 FIX: Strict Case-Sensitive CAPTCHA matching
    const exactCaptchaInput = captchaInput.trim();
    const dataToHash = `${exactCaptchaInput}.${expires}.${nonce}.${SECRET}`;
    const validHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    // 🔥 FIX: Strict Case-Sensitive Match using TimingSafeEqual
    if (hash.length !== validHash.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(validHash))) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid CAPTCHA. Please ensure exact match.", 
        newCaptcha: generateCaptchaData() 
      });
    }

    // 🔥 SECURITY FIX: Mark nonce as used and auto-delete it after 5 minutes
    usedCaptchaNonces.add(nonce);
    setTimeout(() => usedCaptchaNonces.delete(nonce), 5 * 60 * 1000);
    // ==========================================================

    const loginIdentifier = (identifier || email || "").trim();
    if (!loginIdentifier || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Identifier and password are required",
        newCaptcha: generateCaptchaData() // Regenerate on failure
      });
    }

    // 🔥 PRO POLISH: Only lowercase if it's an email format. User IDs remain exact case.
    const isEmail = loginIdentifier.includes("@");
    const emailSearch = isEmail ? loginIdentifier.toLowerCase() : loginIdentifier;

    const deviceCookie = req.cookies ? req.cookies.deviceId : undefined;
    const deviceId = deviceCookie || crypto.randomUUID();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    const { deviceName, locationString } = await getDeviceInfo(req);

    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                      req.headers['x-real-ip'] ||
                      req.socket?.remoteAddress ||
                      'Unknown';

    const deviceInfoString = `[Device: ${deviceName} | Location: ${locationString}]`;

    // 🔥 UPDATED: Query checks if input matches 'email' OR 'userId'
    const user = await User.findOne({ 
      $or: [{ email: emailSearch }, { userId: loginIdentifier }] 
    }).select("+password").lean();
    
    if (!user) {
      // ==========================================
      // 🔥 ADMIN LOGIN LOGIC 
      // ==========================================
      const admin = await Admin.findOne({ 
        $or: [{ email: emailSearch }, { adminId: loginIdentifier }] 
      }).select("+password").lean();
      
      if (admin) {
        // 🔥 SECURITY FIX: 15-Minute Account Lockout Check
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        const lockCheckCount = await AdminLog.countDocuments({
          admin: admin._id, action: "login", status: "failed", createdAt: { $gte: fifteenMinutesAgo }
        });
        if (lockCheckCount >= 5) {
          return res.status(429).json({ success: false, message: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.", newCaptcha: generateCaptchaData() });
        }

        const match = await bcrypt.compare(password, admin.password);
        if (!match) {
          await logActivity({
            adminId: admin._id,
            email: admin.email,                
            action: "login",
            category: "authentication",
            details: "Failed login attempt - Incorrect password ",
            status: "failed",
            req: req,
            role: "admin"
          });
          
          const failedLog = await AdminLog.findOne({ admin: admin._id, status: "failed" }).sort({ createdAt: -1 }).select("_id").lean();
          
          const failedAttemptsCount = await AdminLog.countDocuments({
            admin: admin._id, action: "login", status: "failed", createdAt: { $gte: fifteenMinutesAgo }
          });

          if (failedAttemptsCount > 0 && failedAttemptsCount % 3 === 0) {
            // 🔥 FIRE AND FORGET: Removed await & Updated with Dynamic Env Variables
            transporter.sendMail({
              from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
              to: admin.email,
              subject: `⚠️ Security Alert: Multiple Failed Login Attempts on ${process.env.APP_NAME}`,
              html: failedLoginEmail(failedLog?._id || "Unknown"), 
            })
            .then(() => console.log(`[✉️ EMAIL SUCCESS] Admin security alert sent to ${admin.email}`))
            .catch((mailErr) => console.error(`[⚠️ ADMIN ALERT EMAIL ERROR] Failed to send failed login alert to admin: ${mailErr.message}`, mailErr));
          }
          // 🔥 NEW: Send new Captcha on password failure
          return res.status(401).json({ success: false, message: "Invalid credentials", newCaptcha: generateCaptchaData() });
        }

        // 🔥 SECURITY FIX: Added standard enterprise options to JWT
        const token = jwt.sign(
          { userId: admin._id, role: "admin" }, 
          process.env.JWT_SECRET,
          { 
            expiresIn: "1d",
            issuer: "UBA",
            audience: "UBA_USERS",
            algorithm: "HS256"
          }
        );

        const existingAdminSession = await AdminSession.exists({
          admin: admin._id,
          deviceInfo: deviceInfoString,
        });

        const knownAdminDevice = await AdminLog.exists({
          admin: admin._id,
          action: "login",
          device: deviceName,
          $or: [{ location: locationString }, { location: "Unknown" }], 
          status: "success" 
        });

        if (!deviceCookie && !existingAdminSession && !knownAdminDevice) {
          const newNotif = await Notification.create({
            user: admin._id, 
            type: 'new_login',
            title: 'New admin login detected',
            message: `New login from ${deviceName} in ${locationString}`,
            data: {
              device: deviceName,
              location: locationString,
              ip: ipAddress,
            },
          });
          
          // 🔥 UX UPGRADE: Added error safety block to prevent API crash on socket failure
          try {
            emitToUser(admin._id.toString(), "new_notification", newNotif);
          } catch (err) {
            console.error(`[🔌 SOCKET ERROR] Failed to emit admin new_login notification: ${err.message}`, err);
          }
        }

        await logActivity({
          adminId: admin._id,
          email: admin.email,                
          action: "login",
          category: "authentication",
          details: "Admin logged in successfully ",
          req: req,
          role: "admin"
        });

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
      
      // 🔥 FIX: Prevent User Enumeration Timing Attacks safely with pre-generated hash
      await bcrypt.compare(password, DUMMY_HASH);

      // 🔥 NEW: Send new Captcha on total not-found failure
      return res.status(401).json({ success: false, message: "Invalid credentials", newCaptcha: generateCaptchaData() });
    }

    // 🔥 SECURITY FIX: 15-Minute Account Lockout Check
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const userLockCheckCount = await UserLog.countDocuments({
      user: user._id, action: "login", status: "failed", createdAt: { $gte: fifteenMinutesAgo }
    });
    if (userLockCheckCount >= 5) {
      return res.status(429).json({ success: false, message: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.", newCaptcha: generateCaptchaData() });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logActivity({
        userId: user._id,
        email: user.email,                
        action: "login",
        category: "authentication",
        details: "Failed login attempt - Incorrect password ",
        status: "failed",
        req: req
      });

      const failedLog = await UserLog.findOne({ user: user._id, status: "failed" }).sort({ createdAt: -1 }).select("_id").lean();
      
      const failedAttemptsCount = await UserLog.countDocuments({
        user: user._id,
        action: "login",
        status: "failed",
        createdAt: { $gte: fifteenMinutesAgo }
      });

      if (failedAttemptsCount > 0 && failedAttemptsCount % 3 === 0) {
        // 🔥 FIRE AND FORGET: Removed await & Updated with Dynamic Env Variables
        transporter.sendMail({
          from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
          to: user.email,
          subject: `⚠️ Security Alert: Multiple Failed Login Attempts on ${process.env.APP_NAME}`,
          html: failedLoginEmail(failedLog._id), 
        })
        .then(() => console.log(`[✉️ EMAIL SUCCESS] Security alert email sent to ${user.email} for 3 failed attempts.`))
        .catch((mailErr) => console.error(`[⚠️ USER ALERT EMAIL ERROR] Failed to send security alert email: ${mailErr.message}`, mailErr));
      }
      
      // 🔥 NEW: Send new Captcha on password failure
      return res.status(401).json({ success: false, message: "Invalid credentials", newCaptcha: generateCaptchaData() });
    }

    // 🔥 SECURITY FIX: Added standard enterprise options to JWT
    const token = jwt.sign(
      { userId: user._id, role: user.role }, 
      process.env.JWT_SECRET,
      { 
        expiresIn: "1d",
        issuer: "UBA",
        audience: "UBA_USERS",
        algorithm: "HS256"
      }
    );

    const existingSession = await Session.exists({
      user: user._id,
      deviceInfo: deviceInfoString,
    });

    const knownUserDevice = await UserLog.exists({
      user: user._id,
      action: "login",
      device: deviceName,
      $or: [{ location: locationString }, { location: "Unknown" }], 
      status: "success"
    });

    if (!deviceCookie && !existingSession && !knownUserDevice) {
      const newNotif = await Notification.create({
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

      // 🔥 UX UPGRADE: Added error safety block to prevent API crash on socket failure
      try {
        emitToUser(user._id.toString(), "new_notification", newNotif);
      } catch (err) {
        console.error(`[🔌 SOCKET ERROR] Failed to emit user new_login notification: ${err.message}`, err);
      }
    }

    await logActivity({
      userId: user._id,
      email: user.email,                
      action: "login",
      category: "authentication",
      details: "User logged in successfully ",
      req: req
    });

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
    console.error(`[🚨 LOGIN ERROR] Failure during account authentication process: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
};

/* ================= LOAD USER ================= */
exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password").lean();
    if (!user) {
      const admin = await Admin.findById(req.user.userId).select("-password").lean();
      if (admin) {
        return res.status(200).json({ success: true, user: admin });
      }

      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, user });
  } catch (err) {
    console.error(`[🚨 GET USER ERROR] Failed to retrieve user details from database: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "Failed to load user" });
  }
};

/* ================= LOGOUT ================= */
exports.logoutUser = async (req, res) => {
  try {
    if (req.user && req.user.userId) {
      if (req.user.role === "admin") {
        await logActivity({
          adminId: req.user.userId,
          email: req.user.email,                
          action: "logout",
          category: "authentication",
          details: "Admin logged out successfully ",
          status: "normal",
          req: req,
          role: "admin"
        });

        await AdminSession.deleteOne({ admin: req.user.userId, token: req.token });
        return res.status(200).json({ success: true, message: "Logged out successfully" });
      }

        await logActivity({
        userId: req.user.userId,
        email: req.user.email,                
        action: "logout",
        category: "authentication",
        details: "User logged out successfully ",
        status: "normal",
        req: req
      });

      await Session.deleteOne({ user: req.user.userId, token: req.token });
    }

    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error(`[🚨 LOGOUT ERROR] Failed to complete logout process cleanly: ${err.message}`, err);
    return res.status(200).json({ success: true, message: "Logged out successfully (with logging error)" });
  }
};

/* ========================================================== */
/* NEW: FORGOT PASSWORD FLOW LOGIC              */
/* ========================================================== */

/* ================= REQUEST FORGOT PASSWORD OTP ================= */
exports.forgotPasswordSendOtp = async (req, res) => {
  try {
    const { email, identifier } = req.body;
    
    const lookupId = (identifier || email || "").trim();
    if (!lookupId) {
      return res.status(400).json({ success: false, message: "Email or ID is required" });
    }

    // 🔥 INDUSTRY STANDARD: If they provided an email as identifier, validate the format!
    if (lookupId.includes("@") && !validator.isEmail(lookupId)) {
      return res.status(400).json({ success: false, message: "Invalid email format" });
    }

    const emailSearch = lookupId.includes("@") ? lookupId.toLowerCase() : lookupId;

    let account = await User.findOne({ $or: [{ email: emailSearch }, { userId: lookupId }] }).lean();
    if (!account) {
      account = await Admin.findOne({ $or: [{ email: emailSearch }, { adminId: lookupId }] }).lean();
    }

    if (!account) {
      // 🔥 FIX: Stop User Enumeration by returning a generic success message instead of a 404
      return res.status(200).json({ success: true, message: "If that account exists, a password reset OTP has been sent to the email." });
    }

    const targetEmail = account.email; 

    const existingOtp = await Otp.findOne({ email: targetEmail }).select("createdAt").lean();
    if (existingOtp && Date.now() - existingOtp.createdAt < RESEND_COOLDOWN) {
      return res.status(429).json({ success: false, message: "Please wait before requesting another OTP" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    
    // 🔥 SECURITY FIX: Hash the OTP before saving to database
    const hashedOtp = await bcrypt.hash(otp.toString(), 10);

    // 🔥 FIX: Reset attempts to 0 when generating a new OTP
    await Otp.findOneAndUpdate(
      { email: targetEmail },
      { email: targetEmail, otp: hashedOtp, attempts: 0, createdAt: Date.now() },
      { upsert: true, new: true }
    );

    // 🔥 FIRE AND FORGET: Removed await & Updated with Dynamic Env Variables
    transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: targetEmail,
      subject: `Password Reset Request - ${process.env.APP_NAME}`,
      html: generateAuthEmail("OTP", otp), 
    })
    .then(() => console.log(`[✉️ EMAIL SUCCESS] Password reset OTP sent to ${targetEmail}`))
    .catch((mailErr) => console.error(`[⚠️ EMAIL ERROR] Failed to send password reset OTP: ${mailErr.message}`, mailErr));

    return res.status(200).json({ success: true, message: "If that account exists, a password reset OTP has been sent to the email." });
  } catch (err) {
    console.error(`[🚨 FORGOT PASSWORD ERROR] Failed to send password reset OTP: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};

/* ================= VERIFY FORGOT PASSWORD OTP ================= */
exports.forgotPasswordVerifyOtp = async (req, res) => {
  try {
    const { email, identifier, otp } = req.body;
    const lookupId = (identifier || email || "").trim();

    if (!lookupId || !otp) {
      return res.status(400).json({ success: false, message: "Identifier and OTP are required" });
    }

    const emailSearch = lookupId.includes("@") ? lookupId.toLowerCase() : lookupId;
    let account = await User.findOne({ $or: [{ email: emailSearch }, { userId: lookupId }] }).lean();
    if (!account) account = await Admin.findOne({ $or: [{ email: emailSearch }, { adminId: lookupId }] }).lean();
    
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });
    const targetEmail = account.email;

    // 🔥 SECURITY FIX: Added 'attempts' to the select query
    const record = await Otp.findOne({ email: targetEmail }).select("otp createdAt attempts").lean();
    if (!record) {
      return res.status(400).json({ success: false, message: "OTP not found or expired" });
    }

    // 🔥 SECURITY FIX: Stop OTP brute-forcing
    if (record.attempts >= 5) {
      await Otp.deleteOne({ email: targetEmail });
      return res.status(429).json({ success: false, message: "Too many invalid OTP attempts. Please request a new one." });
    }

    if (Date.now() - record.createdAt > OTP_EXPIRY) {
      await Otp.deleteOne({ email: targetEmail });
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }

    // 🔥 SECURITY FIX: Compare incoming OTP with hashed OTP
    const isMatch = await bcrypt.compare(otp.toString(), record.otp);
    if (!isMatch) {
      // 🔥 SECURITY FIX: Increment failed attempt counter
      await Otp.updateOne({ email: targetEmail }, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    return res.status(200).json({ success: true, message: "OTP verified successfully. Proceed to reset password." });
  } catch (err) {
    console.error(`[🚨 FORGOT PASSWORD VERIFY ERROR] Failed to verify reset OTP: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "OTP verification failed" });
  }
};

/* ================= RESET PASSWORD ================= */
exports.resetPassword = async (req, res) => {
  try {
    const { email, identifier, otp, newPassword } = req.body;
    const lookupId = (identifier || email || "").trim();

    if (!lookupId || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "Identifier, OTP, and new password are required" });
    }

    // 🔥 SECURITY FIX: Enforce strong passwords on reset (Upper, Lower, Number, Special, 8-64 chars)
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&]).{8,64}$/;
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({ success: false, message: "Password must be 8-64 characters and include an uppercase letter, lowercase letter, number, and special character." });
    }

    const emailSearch = lookupId.includes("@") ? lookupId.toLowerCase() : lookupId;
    let account = await User.findOne({ $or: [{ email: emailSearch }, { userId: lookupId }] });
    let role = "user";

    if (!account) {
      account = await Admin.findOne({ $or: [{ email: emailSearch }, { adminId: lookupId }] });
      role = "admin";
    }

    if (!account) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const targetEmail = account.email;

    // 🔥 SECURITY FIX: Added 'attempts' and 'createdAt' to check for lockout/expiry
    const record = await Otp.findOne({ email: targetEmail }).select("otp createdAt attempts").lean();
    if (!record) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    // 🔥 SECURITY FIX: Stop OTP brute-forcing
    if (record.attempts >= 5) {
      await Otp.deleteOne({ email: targetEmail });
      return res.status(429).json({ success: false, message: "Too many invalid OTP attempts. Please request a new one." });
    }

    // 🔥 FIX: OTP Expiry check was missing from resetPassword
    if (Date.now() - record.createdAt > OTP_EXPIRY) {
      await Otp.deleteOne({ email: targetEmail });
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }

    // 🔥 SECURITY FIX: Compare incoming OTP with hashed OTP
    const isMatch = await bcrypt.compare(otp.toString(), record.otp);
    if (!isMatch) {
      // 🔥 SECURITY FIX: Increment failed attempt counter
      await Otp.updateOne({ email: targetEmail }, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    account.password = hashedPassword;
    await account.save();

    const logData = {
      email: targetEmail, 
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

    await Otp.deleteOne({ email: targetEmail });

    // 🔥 FIRE AND FORGET: Removed await & Updated with Dynamic Env Variables
    transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to: targetEmail,
      subject: `Password Reset Successful - ${process.env.APP_NAME}`,
      html: generateAuthEmail("SUCCESS"), 
    })
    .then(() => console.log(`[✉️ EMAIL SUCCESS] Password reset confirmation sent to ${targetEmail}`))
    .catch((mailErr) => console.error(`[⚠️ EMAIL ERROR] Failed to send reset confirmation: ${mailErr.message}`, mailErr));

    return res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error(`[🚨 RESET PASSWORD ERROR] Failed to update user password in DB: ${err.message}`, err);
    return res.status(500).json({ success: false, message: "Failed to update password" });
  }
};

/* ================= CHANGE PASSWORD FOR LOGGED IN USER ================= */

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    let account = await User.findById(req.user.userId).select("+password");
    let role = "user";

    if (!account) {
      account = await Admin.findById(req.user.userId).select("+password");
      role = "admin";
    }

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const match = await bcrypt.compare(currentPassword, account.password);
    if (!match) {
      return res.status(400).json({ message: "Incorrect current password" });
    }

    const isSame = await bcrypt.compare(newPassword, account.password);
    if (isSame) {
      return res.status(400).json({ message: "New password must be different from current password" });
    } 

    // 🔥 SECURITY FIX: Enforce strong passwords on change (Upper, Lower, Number, Special, 8-64 chars)
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*#?&]).{8,64}$/;
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({ message: "Password must be 8-64 characters and include an uppercase letter, lowercase letter, number, and special character." });
    }

    account.password = await bcrypt.hash(newPassword, 10);
    await account.save();

    // 🔥 THE FIX: Pass the raw `req` object directly to the logger! 
    const logData = {
      email: account.email, 
      action: "password_change",
      category: "security",
      details: `${role === 'admin' ? 'Admin' : 'User'} successfully changed their password from settings`,
      req: req, // ✅ Correctly passes the entire raw request
      role: role
    };

    if (role === 'admin') {
      logData.adminId = account._id;
    } else {
      logData.userId = account._id;
    }

    await logActivity(logData);

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(`[🚨 CHANGE PASSWORD ERROR] Internal error while changing password from settings: ${error.message}`, error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//* ================= NOTIFICATIONS ================= *//

exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      user: req.user.userId,
      read: false,
    }).sort({ createdAt: -1 }).lean();
    res.json(notifications);
  } catch (error) {
    console.error(`[🚨 GET NOTIFICATIONS ERROR] Failed to fetch active notifications: ${error.message}`, error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.userId },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error(`[🚨 MARK AS READ ERROR] Failed to update notification read status: ${error.message}`, error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user.userId, read: false },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    console.error(`[🚨 MARK ALL READ ERROR] Failed to bulk update notifications: ${error.message}`, error);
    res.status(500).json({ error: 'Server error' });
  }
};

//* ================= CONTACT FORM SUBMISSION ================= *//

exports.submitContactForm = async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // 🔥 FIX: Added length limit to prevent huge payloads/spam
    if (message.length > 2000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message exceeds the 2000 character limit.' 
      });
    }

    // 🔥 SECURITY FIX: Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 🔥 INDUSTRY STANDARD: Email Validation
    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // 🔥 SECURITY FIX: Sanitize the contact message to prevent XSS attacks
    const sanitizedMessage = validator.escape(message);

    const newContactMessage = new Contact({
      name: name.trim(),
      email: normalizedEmail,
      message: sanitizedMessage,
    });

    await newContactMessage.save();

    // 🔥 UPGRADED: Dynamic Env Variables for Contact Submission Routing
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`, 
      to: process.env.EMAIL_FROM, // Sends notification to YOUR verified email   
      subject: `New Contact Form Submission from ${name} - ${process.env.APP_NAME}`,
      html: ContactEmail(name, normalizedEmail, sanitizedMessage),
      replyTo: normalizedEmail // So hitting "reply" goes to the user, not yourself
    };

    transporter.sendMail(mailOptions).catch(err => {
      console.error(`[✉️ CONTACT FORM EMAIL ERROR] Failed to dispatch admin notification email: ${err.message}`, err);
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully!',
      data: newContactMessage,
    });

  } catch (error) {
    console.error(`[🚨 CONTACT FORM ERROR] Failed to process contact form submission: ${error.message}`, error);
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

    let log = await UserLog.findById(id)
      .select("user device location createdAt details")
      .populate("user", "firstName lastName email")
      .lean();

    let role = "user";

    if (!log) {
      log = await AdminLog.findById(id)
        .select("admin device location createdAt details")
        .populate("admin", "firstName lastName email")
        .lean();
      role = "admin";
    }

    if (!log) return res.status(404).json({ message: "Security log not found" });

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
    console.error(`[🚨 PUBLIC ALERT ERROR] Failed to fetch alert details: ${error.message}`, error);
    res.status(500).json({ message: "Server error fetching alert" });
  }
};

exports.acknowledgePublicAlert = async (req, res) => {
  try {
    const { id } = req.params;
    
    let updated = await UserLog.findByIdAndUpdate(id, { status: "acknowledged" });
    
    if (!updated) {
      updated = await AdminLog.findByIdAndUpdate(id, { status: "acknowledged" });
    }

    if (!updated) return res.status(404).json({ message: "Alert not found" });
    
    res.status(200).json({ message: "Activity acknowledged successfully" });
  } catch (error) {
    console.error(`[🚨 ALERT ACKNOWLEDGE ERROR] Failed to update alert status to acknowledged: ${error.message}`, error);
    res.status(500).json({ message: "Server error acknowledging alert" });
  }
};

exports.securePublicAccount = async (req, res) => {
  try {
    const { id } = req.params;
    
    const userLog = await UserLog.findById(id).select("user").lean();
    if (userLog && userLog.user) {
       await Session.deleteMany({ user: userLog.user });
       return res.status(200).json({ message: "User account secured successfully" });
    }
    
    const adminLog = await AdminLog.findById(id).select("admin").lean();
    if (adminLog && adminLog.admin) {
       await AdminSession.deleteMany({ admin: adminLog.admin });
       return res.status(200).json({ message: "Admin account secured successfully" });
    }
    
    res.status(404).json({ message: "Account/Log not found to secure" });
  } catch (error) {
    console.error(`[🚨 SECURE ACCOUNT ERROR] Failed to delete active sessions for account securing: ${error.message}`, error);
    res.status(500).json({ message: "Server error securing account" });
  }
};