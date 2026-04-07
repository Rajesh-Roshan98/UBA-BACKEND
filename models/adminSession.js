const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  }, 
  email: {
    type: String,
    required: true, // Stores the user's email for quick access without population
    index: true,    // 🔥 ADDED: Fast lookup when finding all active sessions for a specific email
  },
  ipAddress: String,
  location: String,
  deviceInfo: String,
  token: { 
    type: String, 
    required: true,
    index: true,    // 🔥 ADDED: CRITICAL for making your authMiddleware blazing fast on every API request
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400, // MongoDB automatically deletes the session after 24 hours (86400 seconds)
  },
});

// 🔥 UBA OPTIMIZATION (NEW): Speeds up queries when your dashboard or logout route searches for the exact active session token
adminSchema.index({ admin: 1, token: 1 });

module.exports = mongoose.model("AdminSession", adminSchema);