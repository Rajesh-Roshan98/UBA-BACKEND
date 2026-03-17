const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'resolved', 'ignored'],
      default: 'active'
    },
    category: {
      type: String,
      enum: [
        'data-exfiltration', 
        'unusual-location', 
        'brute-force', 
        'privilege-change', 
        'maintenance', 
        'device-change'
      ],
      required: true
    },
    resolvedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Alert', alertSchema);