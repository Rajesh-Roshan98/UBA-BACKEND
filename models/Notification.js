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
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for fast user queries
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);