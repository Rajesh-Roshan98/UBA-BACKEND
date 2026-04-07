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
      type: Number, // numeric OTP
      required: true, 
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