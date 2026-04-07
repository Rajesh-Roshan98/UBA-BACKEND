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
      required: true,
      index: true // 🔥 ADDED: Fast counting for the "Critical Alerts" dashboard card
    },
    status: { 
      type: String,
      enum: ['active', 'resolved', 'ignored'],
      default: 'active',
      index: true // 🔥 ADDED: Fast filtering to only show "active" alerts to admins
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
      required: true,
      index: true // 🔥 ADDED: Fast grouping if you add an "Alerts by Category" pie chart
    },
    resolvedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

// Existing compound indexes (Kept intact!)
alertSchema.index({ user: 1, createdAt: -1 });
alertSchema.index({ severity: 1, status: 1 });

// 🔥 ADDED: Crucial for fetching the global "Latest Alerts" feed across the entire system instantly
alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);