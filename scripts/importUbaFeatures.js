const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
require("dotenv").config();

const dbConnect = require("../config/dbConnect");
const ActivityLog = require("../models/ActivityLog");

const BATCH_SIZE = 1000;

// 🔒 Fixed created date for new entries
const FIXED_CREATED_AT = new Date("2025-12-25T00:00:00.000Z");
 
// ✅ Database-managed keys that should NEVER be wiped by the auto-cleanup
const IGNORED_KEYS = ['_id', '__v', 'createdAt', 'updatedAt', 'status'];

async function importUbaFeatures() {
  await dbConnect();

  const filePath = path.join(__dirname, "../ml/data/processed/uba_predicted.csv");

  if (!fs.existsSync(filePath)) {
    console.error("❌ uba_predicted.csv not found. Run detection.py first.");
    process.exit(1);
  }

  console.log("📥 Syncing UBA features: Automatic field cleanup + Smart date preservation...");

  // 🔹 Load existing data (Need full docs to check for changes)
  const existingLogs = await ActivityLog.find({ action: "aggregated_activity" }).lean();

  const existingMap = new Map();
  for (const log of existingLogs) {
    existingMap.set(`${log.user_id}|aggregated_activity`, log);
  }

  let batch = [];
  let totalRead = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  const processBatch = async (ops) => {
    if (ops.length === 0) return;
    const result = await ActivityLog.bulkWrite(ops, { ordered: false });
    totalInserted += result.upsertedCount || 0;
    totalUpdated += result.modifiedCount || 0;
  };

  // ✅ FIX: Strip invisible spaces from CSV column names
  const stream = fs.createReadStream(filePath).pipe(csv({
    mapHeaders: ({ header }) => header.trim()
  }));

  for await (const row of stream) {
    totalRead++;
    if (totalRead % 1000 === 0) console.log(`Rows processed: ${totalRead}`);

    // 1. Prepare the incoming data document (Exactly as you wrote it, no auto-calculations)
    const doc = {
      user_id: row.user_id?.trim() || "unknown_user",
      employee_name: row.employee_name?.trim() || "Unknown",
      role: row.role?.trim() || "Unknown",
      email: row.email?.trim() || "Unknown",                
      action: "aggregated_activity",
      days_active: Number(row.days_active ?? 0) || 0,
      total_lifetime_hours: Number(row.total_lifetime_hours ?? 0) || 0,
      total_activity: Number(row.total_activity ?? 0) || 0,
      login_count: Number(row.login_count ?? 0) || 0,
      login_per_day: Number(row.login_per_day ?? 0) || 0,
      unique_pcs: Number(row.unique_pcs ?? 0) || 0,
      avg_active_hours_per_day: Number(row.avg_active_hours_per_day ?? 0) || 0,
      actions_per_hour: Number(row.actions_per_hour ?? 0) || 0,
      activity_per_day: Number(row.activity_per_day ?? 0) || 0,
      file_access_count: Number(row.file_access_count ?? 0) || 0,
      file_copy_count: Number(row.file_copy_count ?? 0) || 0,
      removable_uploads: Number(row.removable_uploads ?? 0) || 0,
      removable_downloads: Number(row.removable_downloads ?? 0) || 0,
      decoy_access_count: Number(row.decoy_access_count ?? 0) || 0,
      email_sent_count: Number(row.email_sent_count ?? 0) || 0,  
      total_email_size: Number(row.total_email_size ?? 0) || 0,
      avg_email_size: Number(row.avg_email_size ?? 0) || 0,
      attachment_count: Number(row.attachment_count ?? 0) || 0,  
      after_hours_activity: Number(row.after_hours_activity ?? 0) || 0, 
      weekend_activity: Number(row.weekend_activity ?? 0) || 0,          
      
      // ✅ Device Features
      device_activity_count: Number(row.device_activity_count ?? 0) || 0,
      device_connect_count: Number(row.device_connect_count ?? 0) || 0,
      device_disconnect_count: Number(row.device_disconnect_count ?? 0) || 0,
      device_unique_pcs: Number(row.device_unique_pcs ?? 0) || 0,
      device_after_hours: Number(row.device_after_hours ?? 0) || 0,
      device_weekend_usage: Number(row.device_weekend_usage ?? 0) || 0,
      device_usage_per_day: Number(row.device_usage_per_day ?? 0) || 0,
      connect_disconnect_ratio: Number(row.connect_disconnect_ratio ?? 0) || 0,
      avg_session_duration: Number(row.avg_session_duration ?? 0) || 0,
      
      // ✅ Daily Rate Metrics
      file_access_per_day: Number(row.file_access_per_day ?? 0) || 0,
      file_copy_per_day: Number(row.file_copy_per_day ?? 0) || 0,
      email_sent_per_day: Number(row.email_sent_per_day ?? 0) || 0,
      usb_upload_per_day: Number(row.usb_upload_per_day ?? 0) || 0,
      usb_download_per_day: Number(row.usb_download_per_day ?? 0) || 0,
      device_connect_per_day: Number(row.device_connect_per_day ?? 0) || 0,
      device_disconnect_per_day: Number(row.device_disconnect_per_day ?? 0) || 0,
      decoy_access_per_day: Number(row.decoy_access_per_day ?? 0) || 0,

      // ✅ Rolling Windows & Drift
      window_7_days: Number(row.window_7_days ?? 0) || 0,
      window_30_days: Number(row.window_30_days ?? 0) || 0,
      baseline_90_days: Number(row.baseline_90_days ?? 0) || 0,
      drift_7d_vs_30d: Number(row.drift_7d_vs_30d ?? 0) || 0,
      drift_30d_vs_90d: Number(row.drift_30d_vs_90d ?? 0) || 0,

      // Risk & Explanations
      risk_score: Number(row.risk_score ?? 0) || 0,                      
      anomaly_score: Number(row.anomaly_score ?? 0) || 0,                
      explanation: row.explanation || "",                          
      severity: row.severity || "Low",                             
      prediction: Number(row.prediction) || 1, 
      prediction_label: row.prediction_label || "Normal",
      prediction_raw: Number(row.prediction) || 1
    };

    const key = `${doc.user_id}|${doc.action}`;
    const existing = existingMap.get(key);

    // ✅ FIX: Ignore database-managed keys so they don't get deleted
    const unsetFields = existing
    ? Object.keys(existing)
        .filter(k => !IGNORED_KEYS.includes(k) && !Object.keys(doc).includes(k))
        .reduce((acc, k) => { acc[k] = ""; return acc; }, {})
    : {};

    // ✅ Conditionally build the update payload so Mongoose doesn't crash on an empty $unset
    const updatePayload = Object.keys(unsetFields).length > 0 
      ? { $set: doc, $unset: unsetFields } 
      : { $set: doc };

    if (!existing) {
      // 🆕 NEW RECORD
      doc.createdAt = FIXED_CREATED_AT;
      doc.updatedAt = new Date();
      batch.push({
        updateOne: {
          filter: { user_id: doc.user_id, action: doc.action },
          update: updatePayload,
          upsert: true
        }
      });
    } else {
      // 1. Check for value changes in the fields we care about
      const EPSILON = 1e-6;

      // ✅ FIX: Safe comparison (existing.field || 0) ensures no NaN math errors on old database records
      const valuesChanged =
        Math.abs((existing.days_active || 0) - doc.days_active) > EPSILON ||
        existing.employee_name !== doc.employee_name ||
        existing.role !== doc.role ||
        existing.email !== doc.email ||
        Math.abs((existing.total_lifetime_hours || 0) - doc.total_lifetime_hours) > EPSILON ||
        Math.abs((existing.total_activity || 0) - doc.total_activity) > EPSILON ||
        Math.abs((existing.login_count || 0) - doc.login_count) > EPSILON ||
        Math.abs((existing.login_per_day || 0) - doc.login_per_day) > EPSILON ||
        Math.abs((existing.unique_pcs || 0) - doc.unique_pcs) > EPSILON ||
        Math.abs((existing.avg_active_hours_per_day || 0) - doc.avg_active_hours_per_day) > EPSILON ||
        Math.abs((existing.actions_per_hour || 0) - doc.actions_per_hour) > EPSILON ||
        Math.abs((existing.activity_per_day || 0) - doc.activity_per_day) > EPSILON ||
        Math.abs((existing.file_access_count || 0) - doc.file_access_count) > EPSILON ||
        Math.abs((existing.file_copy_count || 0) - doc.file_copy_count) > EPSILON ||
        Math.abs((existing.removable_uploads || 0) - doc.removable_uploads) > EPSILON ||
        Math.abs((existing.removable_downloads || 0) - doc.removable_downloads) > EPSILON ||
        Math.abs((existing.decoy_access_count || 0) - doc.decoy_access_count) > EPSILON ||
        Math.abs((existing.email_sent_count || 0) - doc.email_sent_count) > EPSILON ||
        Math.abs((existing.total_email_size || 0) - doc.total_email_size) > EPSILON ||
        Math.abs((existing.avg_email_size || 0) - doc.avg_email_size) > EPSILON ||
        Math.abs((existing.attachment_count || 0) - doc.attachment_count) > EPSILON ||
        Math.abs((existing.after_hours_activity || 0) - doc.after_hours_activity) > EPSILON ||
        Math.abs((existing.weekend_activity || 0) - doc.weekend_activity) > EPSILON ||
        Math.abs((existing.device_activity_count || 0) - doc.device_activity_count) > EPSILON ||
        Math.abs((existing.device_connect_count || 0) - doc.device_connect_count) > EPSILON ||
        Math.abs((existing.device_disconnect_count || 0) - doc.device_disconnect_count) > EPSILON ||
        Math.abs((existing.device_unique_pcs || 0) - doc.device_unique_pcs) > EPSILON ||
        Math.abs((existing.device_after_hours || 0) - doc.device_after_hours) > EPSILON ||
        Math.abs((existing.device_weekend_usage || 0) - doc.device_weekend_usage) > EPSILON ||
        Math.abs((existing.connect_disconnect_ratio || 0) - doc.connect_disconnect_ratio) > EPSILON ||
        Math.abs((existing.avg_session_duration || 0) - doc.avg_session_duration) > EPSILON ||
        Math.abs((existing.device_usage_per_day || 0) - doc.device_usage_per_day) > EPSILON ||
        Math.abs((existing.file_access_per_day || 0) - doc.file_access_per_day) > EPSILON ||
        Math.abs((existing.file_copy_per_day || 0) - doc.file_copy_per_day) > EPSILON ||
        Math.abs((existing.email_sent_per_day || 0) - doc.email_sent_per_day) > EPSILON ||
        Math.abs((existing.usb_upload_per_day || 0) - doc.usb_upload_per_day) > EPSILON ||
        Math.abs((existing.usb_download_per_day || 0) - doc.usb_download_per_day) > EPSILON ||
        Math.abs((existing.device_connect_per_day || 0) - doc.device_connect_per_day) > EPSILON ||
        Math.abs((existing.device_disconnect_per_day || 0) - doc.device_disconnect_per_day) > EPSILON ||
        Math.abs((existing.decoy_access_per_day || 0) - doc.decoy_access_per_day) > EPSILON ||
        Math.abs((existing.window_7_days || 0) - doc.window_7_days) > EPSILON ||
        Math.abs((existing.window_30_days || 0) - doc.window_30_days) > EPSILON ||
        Math.abs((existing.baseline_90_days || 0) - doc.baseline_90_days) > EPSILON ||
        Math.abs((existing.drift_7d_vs_30d || 0) - doc.drift_7d_vs_30d) > EPSILON ||
        Math.abs((existing.drift_30d_vs_90d || 0) - doc.drift_30d_vs_90d) > EPSILON ||
        Math.abs((existing.risk_score || 0) - doc.risk_score) > EPSILON ||
        Math.abs((existing.anomaly_score || 0) - doc.anomaly_score) > EPSILON ||
        existing.explanation !== doc.explanation ||
        existing.severity !== doc.severity ||
        existing.prediction_label !== doc.prediction_label ||
        (existing.prediction || 1) !== doc.prediction ||
        (existing.prediction_raw || 1) !== doc.prediction_raw;

      const docKeys = Object.keys(doc);
      
      // ✅ FIX: Trigger an update if brand new columns exist in doc that aren't in existing
      const hasDeletedFields = Object.keys(existing).some(k => !IGNORED_KEYS.includes(k) && !docKeys.includes(k));
      const hasNewFields = docKeys.some(k => !Object.keys(existing).includes(k) && !IGNORED_KEYS.includes(k));
      const schemaChanged = hasDeletedFields || hasNewFields;

      if (valuesChanged || schemaChanged) {
        // Only update if values are different OR if there are old fields to wipe
        doc.createdAt = existing.createdAt || FIXED_CREATED_AT;
        doc.updatedAt = new Date();

        doc.status = existing.status || "open";

        batch.push({
          updateOne: {
            filter: { user_id: doc.user_id, action: doc.action },
            update: updatePayload,
            upsert: true
          }
        });
      }
    }

    if (batch.length >= BATCH_SIZE) {
      try {
        await processBatch(batch);
      } catch (err) {
        console.error("❌ Batch failed:", err);
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    try {
      await processBatch(batch);
    } catch (err) {
      console.error("❌ Final batch failed:", err);
    }
  }

  console.log(`📊 Total rows read: ${totalRead}`);
  console.log(`🆕 Inserted (Brand New): ${totalInserted}`);
  console.log(`🔄 Updated (Modified): ${totalUpdated}`);
  console.log(`⏭️ Unchanged (Dates preserved): ${totalRead - totalInserted - totalUpdated}`);

  console.log("✅ Sync complete. Closing database connection.");
  process.exit(0);
}

importUbaFeatures();
