const mongoose = require("mongoose");

// ✅ FIX: Renamed variable from userSchema to adminSchema so the export at the bottom works
const adminSchema = new mongoose.Schema(
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
      enum: ["admin"],
      default: "admin", // 💡 Tip: Set the default to "admin" for this specific model!
      lowercase: true,
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

// ✅ ADDED INDEXES FOR QUERY OPTIMIZATION
adminSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Admin", adminSchema);