const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',        // Works for both users and admins (both are stored in separate collections)
    required: true,
  },
  type: {
    type: String,
    enum: ['new_login', 'email_verification', 'system'],
    required: true,
    index: true, // 🔥 ADDED: Fast filtering if an admin wants to see only 'system' or 'new_login' alerts
  }, 
  title: String,
  message: String,
  data: {
    device: String,
    location: String,
    ip: String,
  },
  read: {
    type: Boolean,
    default: false,
    index: true, // 🔥 ADDED: Fast counting for global unread notifications
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true, // 🔥 ADDED: Crucial for fast sorting of the newest notifications globally
  },
});

// Index for fast user queries (Kept exactly as is — this is a perfect compound index!)
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);