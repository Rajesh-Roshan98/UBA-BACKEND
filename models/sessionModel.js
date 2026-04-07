const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  email: {
    type: String,
    required: true, // Stores the user's email for quick access without population
    index: true,    // 🔥 ADDED: Fast lookup when finding all active sessions for a specific user
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
sessionSchema.index({ user: 1, token: 1 });

module.exports = mongoose.model("Session", sessionSchema);