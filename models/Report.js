const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String, 
      required: true // e.g., 'Monthly User Activity Report - Jan'
    },
    fileSize: {
      type: String, // e.g., '2.4 MB'
    },
    fileType: {
      type: String,
      enum: ['PDF', 'CSV', 'JSON'],
      required: true,
      index: true // 🔥 ADDED: Fast filtering if an admin wants to see only CSVs or only PDFs
    },
    url: {
      type: String,
      required: true // The AWS S3 link or local path where the file is actually stored
    }
  },
  { timestamps: true }
);

// Existing compound index (Perfect for finding a specific user's reports quickly)
reportSchema.index({ user: 1, createdAt: -1 });

// 🔥 ADDED: Crucial for fetching the global "Recent Reports" list across all users instantly
reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);