const mongoose = require("mongoose");

const userLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: {
      type: String,
      required: true, // Stores the user's email for quick access without population
      index: true,    // 🔥 ADDED: Fast lookup for logs by a specific user's email globally
    },
    action: { 
      type: String,
      required: true, // e.g., 'login', 'data_export', 'database_query'
      index: true,    // 🔥 ADDED: Fast filtering for specific actions across all users
    },
    category: {
      type: String,
      required: true, // e.g., 'data_access', 'authentication', 'system'
    },
    details: {
      type: String,
      required: true, // e.g., 'Exported 2.4GB from Customer DB'
    },
    status: {
      type: String,
      enum: ["success", "failed", "normal", "warning", "critical"],
      default: "normal",
      index: true,    // 🔥 ADDED: Fast counting/filtering for failed or critical user actions globally
    },
    // These fields are crucial for the Resource Access aggregation
    resourceName: {
      type: String, // e.g., 'Customer DB', 'Q1_Report.pdf'
    },
    resourceType: {
      type: String, // e.g., 'SQL Query', 'Download', 'Read'
    },
    location: {
      type: String,
      default: "Unknown",
    },
    device: {
      type: String,
      default: "Unknown",
    },
  },
  { timestamps: true }, // Automatically creates 'createdAt' and 'updatedAt'
);

// Indexes are highly recommended here since you will query this collection constantly
userLogSchema.index({ user: 1, createdAt: -1 });
userLogSchema.index({ category: 1 });
userLogSchema.index({ createdAt: -1 }); // 🔥 ADDED: Crucial for fast time-based sorting globally (e.g., "Latest User Activity")

// 🔥 UBA OPTIMIZATION (NEW): Helps your anomaly detection engine quickly compare login locations
userLogSchema.index({ user: 1, action: 1, location: 1 });
userLogSchema.index({ user: 1, action: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("UserLog", userLogSchema);