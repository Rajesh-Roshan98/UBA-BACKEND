const mongoose = require("mongoose");

// 🔒 Fixed created date
const FIXED_CREATED_AT = new Date("2025-12-25T00:00:00.000Z");

const activitySchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
      index: true,
    },

    // ✅ Employee Details
    employee_name: { 
      type: String, 
      default: "Unknown" 
    },
    
    role: { 
      type: String, 
      default: "Unknown" 
    },

    // ✅ ADDED: User Email
    email: {
      type: String,
      default: "Unknown"
    },

    action: {
      type: String,
      default: "aggregated_activity",
    },

    // ---------- BEHAVIOR FEATURES ----------
    days_active: { type: Number, default: 0 }, 
    
    // Verification Metrics
    total_lifetime_hours: { type: Number, default: 0 }, 
    total_activity: { type: Number, default: 0 },

    login_count: { type: Number, default: 0 },
    login_per_day: { type: Number, default: 0 }, 
    unique_pcs: { type: Number, default: 0 },
    avg_active_hours_per_day: { type: Number, default: 0 }, // ✅ ADDED from Python pipeline
    actions_per_hour: { type: Number, default: 0 },
    activity_per_day: { type: Number, default: 0 }, // ✅ ADDED from Python pipeline
    
    file_access_count: { type: Number, default: 0 },
    file_copy_count: { type: Number, default: 0 },
    removable_uploads: { type: Number, default: 0 },
    removable_downloads: { type: Number, default: 0 },
    decoy_access_count: { type: Number, default: 0 },

    // ✅ ADDED: Email Metrics
    email_sent_count: { type: Number, default: 0 },
    total_email_size: { type: Number, default: 0 },
    avg_email_size: { type: Number, default: 0 }, 
    attachment_count: { type: Number, default: 0 },

    // 🚀 ADDED: Temporal Behavior Metrics
    after_hours_activity: { type: Number, default: 0 },
    weekend_activity: { type: Number, default: 0 },

    // ✅ ADDED: Device Metrics
    device_activity_count: { type: Number, default: 0 },
    device_connect_count: { type: Number, default: 0 },
    device_disconnect_count: { type: Number, default: 0 },
    device_unique_pcs: { type: Number, default: 0 },
    device_after_hours: { type: Number, default: 0 },
    device_weekend_usage: { type: Number, default: 0 },
    device_usage_per_day: { type: Number, default: 0 },
    connect_disconnect_ratio: { type: Number, default: 0 },
    avg_session_duration: { type: Number, default: 0 },

    // 📊 NEW: Daily Rate Metrics (from Python pipeline)
    file_access_per_day: { type: Number, default: 0 },
    file_copy_per_day: { type: Number, default: 0 },
    email_sent_per_day: { type: Number, default: 0 },
    usb_upload_per_day: { type: Number, default: 0 },
    usb_download_per_day: { type: Number, default: 0 },
    device_connect_per_day: { type: Number, default: 0 },
    device_disconnect_per_day: { type: Number, default: 0 },
    decoy_access_per_day: { type: Number, default: 0 },

    // 📈 NEW: Rolling Windows & Behavioral Drift Metrics
    window_7_days: { type: Number, default: 0 },
    window_30_days: { type: Number, default: 0 },
    baseline_90_days: { type: Number, default: 0 },
    drift_7d_vs_30d: { type: Number, default: 0 },
    drift_30d_vs_90d: { type: Number, default: 0 },

    // 🚫 REMOVED: Psychometric (OCEAN) Metrics to match enterprise standards

    // ---------- ML OUTPUT ----------
    prediction: {
      type: Number, // ✅ Fixed Data Type for IsolationForest Output (1 or -1)
      default: 1,
      index: true,
    },

    prediction_label: {
      type: String, // ✅ Added to catch "Normal" / "Anomaly" strings
      enum: ["Normal", "Anomaly"],
      default: "Normal",
    },

    prediction_raw: {
      type: Number,
      default: 1,
    },

    status: {
      type: String,
      enum: ["open", "pending", "investigating", "resolved", "closed", "false-positive"],
      default: "open"
    },

    // 🚀 ADDED: Advanced Scoring and Explanations
    risk_score: {
      type: Number,
      default: 0,
    },
    anomaly_score: {
      type: Number,
      default: 0,
    },
    explanation: {
      type: String,
      default: "",
    },
    
    // 🔥 ADDED: Strict Severity Levels
    severity: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Low",
    },

    // 🔥 OVERRIDE TIMESTAMPS
    createdAt: {
      type: Date,
      default: FIXED_CREATED_AT, // ✅ ALWAYS 25/12/2025
      immutable: true,           // 🔒 cannot be changed
    },

    updatedAt: {
      type: Date,
      default: Date.now,         // ✅ CURRENT DATE
    },
  },
  {
    timestamps: false, // 🔥 disable mongoose auto timestamps
  }
);

activitySchema.index({ user_id: 1, action: 1 }, { unique: true });

// 🔄 Auto-update updatedAt on save()
activitySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// 🔄 Auto-update updatedAt on update operations
activitySchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

const ActivityLog = mongoose.model("ActivityLog", activitySchema);
module.exports = ActivityLog;