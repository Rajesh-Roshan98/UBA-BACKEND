const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is Required"],
      trim: true,
      index: true, // 🔥 ADDED: Fast lookup when verifying or deleting OTPs for a specific user
    },
    otp: {
      type: String, // 🔥 FIX: Changed from Number to String to safely store the bcrypt hash
      required: true, 
    },
    // 🔥 SECURITY FIX: Added attempts tracker to prevent OTP brute-force guessing
    attempts: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300, // OTP expires after 5 minutes (MongoDB automatically builds a TTL index here!)
    },
  },
  { timestamps: true }
);

// This is already a perfect compound index for finding the "Latest OTP for a specific email"
otpSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("Otp", otpSchema);