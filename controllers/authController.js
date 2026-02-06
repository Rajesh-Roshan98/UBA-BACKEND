const User = require("../models/userModel");
const Otp = require("../models/otpModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const generateOtpEmail = require("../utils/otpEmailTemplate");

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

    // 🔒 Only existing users can verify
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

    // 🔢 Generate numeric OTP
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
      ...(process.env.NODE_ENV !== "production" && { otp }), // Only for dev/testing
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

    // 🔢 Compare numeric OTP
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
    // REMOVED: role
    const { firstName, middleName, lastName, email, password } = req.body;

    // REMOVED: !role check
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
      // REMOVED: role field
      isEmailVerified: false, 
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        // REMOVED: role from response
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

    const user = await User.findOne({ email }).select("+password");
    if (!user)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    // REMOVED: role from JWT payload
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
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
        // REMOVED: role from response
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
    if (!user)
      return res.status(404).json({
        success: false,
        message: "User not found",
      });

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
  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};