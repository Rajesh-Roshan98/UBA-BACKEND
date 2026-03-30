const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is Required"],
      trim: true,
    },
    otp: {
      type: Number, // numeric OTP
      required: true, 
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300, // OTP expires after 5 minutes
    },
  },
  { timestamps: true }
);

otpSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("Otp", otpSchema);
