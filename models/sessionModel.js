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
  },
  ipAddress: String,
  deviceInfo: String,
  token: { 
    type: String, 
    required: true 
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400, 
  },
});

// 🔥 UBA OPTIMIZATION (NEW): Speeds up queries when your dashboard or logout route searches for the exact active session token
sessionSchema.index({ user: 1, token: 1 });

module.exports = mongoose.model("Session", sessionSchema);