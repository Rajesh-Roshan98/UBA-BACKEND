const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
      index: true, // 🔥 ADDED: Fast lookup if an admin searches messages by a specific user's email
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// 🔥 ADDED: Crucial for fast time-based sorting so your "Latest Messages" table loads instantly
contactSchema.index({ createdAt: -1 });

const Contact = mongoose.model('Contact', contactSchema);

// Export using CommonJS 
module.exports = Contact;