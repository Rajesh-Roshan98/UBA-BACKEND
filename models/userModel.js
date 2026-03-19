const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First Name is Required"],
      trim: true,
    },
    middleName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last Name is Required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is Required"],
      trim: true,
      unique: true,
      index: true,
      lowercase: true,
    },
    password: {
      type: String,
      select: false,
    },

    // ✅ THIS FIELD WAS MISSING (CRITICAL)
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["user"],
      default: "user",
      lowercase: true,
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // 🔥 UBA BASELINE TRACKING (NEW - DOES NOT BREAK EXISTING LOGIC)
    // These arrays will be incredibly useful for your UBA anomaly detection later.
    // You can compare future logins against these to detect stolen credentials.
    trustedLocations: {
      type: [String],
      default: [], // e.g., ["Mumbai, Maharashtra", "Pune, Maharashtra"]
    },
    trustedDevices: {
      type: [String],
      default: [], // e.g., ["Windows Chrome", "Android Chrome"]
    },
    phone: { 
      type: String, 
      default: "" 
    },
    location: { 
      type: String, 
      default: "unknown" 
    },
    avatar: { 
      type: String, 
      default: ""
    },
    bio: { 
      type: String, 
      default: "" 
    },
    joinDate: { 
      type: Date, 
      default: Date.now,
      immutable: true 
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);