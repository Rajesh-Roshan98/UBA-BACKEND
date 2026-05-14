const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    adminId: {
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
      required: [true, "Last Name is Required"],
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
      index: true, // 🔥 ADDED: Fast filtering for verified vs unverified admins
    },
    role: {
      type: String,
      enum: ["admin"],
      default: "admin", // 💡 Tip: Set the default to "admin" for this specific model!
      lowercase: true,
      index: true, // 🔥 ADDED: Fast lookup if you ever add 'superadmin' or other roles
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
adminSchema.index({ createdAt: -1 }); // Fast sorting for "Newest Admins"
adminSchema.index({ updatedAt: -1 }); // 🔥 ADDED: Fast sorting for "Recently Updated Profiles"

module.exports = mongoose.model("Admin", adminSchema);