const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
require("dotenv").config();

const dbConnect = require("../config/dbConnect");
const ActivityLog = require("../models/ActivityLog");

const BATCH_SIZE = 1000;

// 🔒 Fixed created date
const FIXED_CREATED_AT = new Date("2025-12-25T00:00:00.000Z");

async function importUbaFeatures() {
  await dbConnect();

  const filePath = path.join(
    __dirname,
    "../ml/data/processed/uba_predicted.csv"
  );

  if (!fs.existsSync(filePath)) {
    console.error("❌ uba_predicted.csv not found. Run detection.py first.");
    process.exit(1);
  }

  console.log("📥 Importing UBA features (update-only-if-changed)...");

  // 🔹 Load existing data ONCE
  const existingLogs = await ActivityLog.find(
    { action: "aggregated_activity" },
    {
      user_id: 1,
      login_count: 1,
      unique_pcs: 1,
      active_hours: 1,
      actions_per_hour: 1,
      file_access_count: 1,
      file_copy_count: 1,
      removable_uploads: 1,
      removable_downloads: 1,
      decoy_access_count: 1,
      prediction: 1,
      prediction_raw: 1
    }
  ).lean();

  // 🔹 Create lookup map
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

  const stream = fs.createReadStream(filePath).pipe(csv());

  for await (const row of stream) {
    totalRead++;

    const doc = {
      user_id: row.user_id?.trim() || "unknown_user",
      action: "aggregated_activity",
      login_count: Number(row.login_count) || 0,
      unique_pcs: Number(row.unique_pcs) || 0,
      active_hours: Number(row.active_hours) || 0,
      actions_per_hour: Number(row.actions_per_hour) || 0,
      file_access_count: Number(row.file_access_count) || 0,
      file_copy_count: Number(row.file_copy_count) || 0,
      removable_uploads: Number(row.removable_uploads) || 0,
      removable_downloads: Number(row.removable_downloads) || 0,
      decoy_access_count: Number(row.decoy_access_count) || 0,
      prediction: row.prediction_label || "Normal",
      prediction_raw: Number(row.prediction) || 1,
    };

    const key = `${doc.user_id}|${doc.action}`;
    const existing = existingMap.get(key);

    // 🆕 NEW RECORD → INSERT
    if (!existing) {
      batch.push({
        updateOne: {
          filter: { user_id: doc.user_id, action: doc.action },
          update: {
            $set: { ...doc, updatedAt: new Date() },
            $setOnInsert: { createdAt: FIXED_CREATED_AT },
          },
          upsert: true
        }
      });
    } 
    // 🔄 EXISTING → UPDATE ONLY IF CHANGED
    else {
      const changed =
        existing.login_count !== doc.login_count ||
        existing.unique_pcs !== doc.unique_pcs ||
        existing.active_hours !== doc.active_hours ||
        existing.actions_per_hour !== doc.actions_per_hour ||
        existing.file_access_count !== doc.file_access_count ||
        existing.file_copy_count !== doc.file_copy_count ||
        existing.removable_uploads !== doc.removable_uploads ||
        existing.removable_downloads !== doc.removable_downloads ||
        existing.decoy_access_count !== doc.decoy_access_count ||
        existing.prediction !== doc.prediction ||
        existing.prediction_raw !== doc.prediction_raw;

      if (changed) {
        batch.push({
          updateOne: {
            filter: { user_id: doc.user_id, action: doc.action },
            update: {
              $set: { ...doc, updatedAt: new Date() }, // ✅ update only changed rows
              $setOnInsert: { createdAt: FIXED_CREATED_AT }, // for safety if upsert happens
            },
          }
        });
      }
    }

    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await processBatch(batch);
  }

  console.log(`📊 Total rows read: ${totalRead}`);
  console.log(`🆕 Inserted: ${totalInserted}`);
  console.log(`🔄 Updated: ${totalUpdated}`);
  console.log(`⏭️ Unchanged: ${totalRead - totalInserted - totalUpdated}`);

  process.exit(0);
}

importUbaFeatures();
