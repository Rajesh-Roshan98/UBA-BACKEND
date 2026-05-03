const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      unique: true,
      required: true,
      index: true, // 🔥 ADDED: Fast lookup by userId
    },
    firstName: {
      type: String,
      required: [true, "First Name is Required"],
      minlength: [2, "First name must be at least 2 characters"],
      maxlength: [50, "First name cannot exceed 50 characters"], 
      trim: true,
    },
    middleName: {
      type: String,
      maxlength: [50, "Middle name cannot exceed 50 characters"],
      trim: true,
    },
    lastName: {
      type: String,
      maxlength: [50, "Last name cannot exceed 50 characters"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is Required"],
      trim: true,
      unique: true,
      index: true, // Already perfectly indexed!
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false, 
    },

    // ✅ THIS FIELD WAS MISSING (CRITICAL)
    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true, // 🔥 ADDED: Fast filtering for verified vs unverified users
    },
    role: {
      type: String,
      enum: ["user"],
      default: "user",
      lowercase: true,
      index: true, // 🔥 ADDED: Fast lookup by role
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
      default: "",
      match: [/(^\d{10}$)|^$/, "Phone number must be exactly 10 digits"]
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

// ✅ ADDED INDEXES FOR QUERY OPTIMIZATION
userSchema.index({ createdAt: -1 }); // Fast sorting for "Newest Users"
userSchema.index({ updatedAt: -1 }); // 🔥 ADDED: Fast sorting for "Recently Updated Profiles"
userSchema.index({ riskScore: -1 }); // 🔥 FIXED: Changed to -1 so you can quickly find the HIGHEST risk scores first

module.exports = mongoose.model("User", userSchema);