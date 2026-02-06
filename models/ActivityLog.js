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

    action: {
      type: String,
      default: "aggregated_activity",
    },

    // ---------- BEHAVIOR FEATURES ----------
    login_count: { type: Number, default: 0 },
    unique_pcs: { type: Number, default: 0 },
    active_hours: { type: Number, default: 0 },
    actions_per_hour: { type: Number, default: 0 },
    file_access_count: { type: Number, default: 0 },
    file_copy_count: { type: Number, default: 0 },
    removable_uploads: { type: Number, default: 0 },
    removable_downloads: { type: Number, default: 0 },
    decoy_access_count: { type: Number, default: 0 },

    // ---------- ML OUTPUT ----------
    prediction: {
      type: String,
      enum: ["Normal", "Anomaly"],
      default: "Normal",
      index: true,
    },

    prediction_raw: {
      type: Number,
      default: 1,
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

// 🔄 Auto-update updatedAt on save()
activitySchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// 🔄 Auto-update updatedAt on update operations
// ❌ DO NOT include bulkWrite (it has no this.set)
activitySchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

const ActivityLog = mongoose.model("ActivityLog", activitySchema);
module.exports = ActivityLog;
