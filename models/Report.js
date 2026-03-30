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
      required: true
    },
    url: {
      type: String,
      required: true // The AWS S3 link or local path where the file is actually stored
    }
  },
  { timestamps: true }
);

reportSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);