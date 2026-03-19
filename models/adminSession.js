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
adminSchema.index({ admin: 1, token: 1 });

module.exports = mongoose.model("AdminSession", adminSchema);