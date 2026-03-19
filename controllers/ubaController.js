const e = require("express");
const ActivityLog = require("../models/ActivityLog");
const { exec } = require("child_process");

exports.createLog = async (req, res) => {
  try {
    // ✅ Extract all needed fields (Added 'email' to prevent ReferenceError crash)
    const { user_id, action, employee_name, role, email } = req.body;

    if (!user_id || !action) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Fetch existing logs for this user 
    const userLogs = await ActivityLog.find({ user_id });

    // ---------- FEATURE CALCULATIONS ----------
    
    // 1. Days Active
    const days_active =
      userLogs.filter((l) => l.action === "days_active").length +
      (action === "days_active" ? 1 : 0);

    const safe_days = days_active || 1; // Used for daily math

    // 2. Specific Counts (Expanded for new model)
    const login_count =
      userLogs.filter((l) => l.action === "login").length +
      (action === "login" ? 1 : 0);

    const file_access_count =
      userLogs.filter((l) => l.action === "file_access").length +
      (action === "file_access" ? 1 : 0);

    const decoy_access_count =
      userLogs.filter((l) => l.action === "decoy_file").length +
      (action === "decoy_file" ? 1 : 0);

    // ✅ ADDED: New Counts for Model
    const file_copy_count = 
      userLogs.filter((l) => l.action === "file_copy").length + 
      (action === "file_copy" ? 1 : 0);

    const removable_uploads = 
      userLogs.filter((l) => l.action === "removable_upload").length + 
      (action === "removable_upload" ? 1 : 0);

    const removable_downloads = 
      userLogs.filter((l) => l.action === "removable_download").length + 
      (action === "removable_download" ? 1 : 0);

    // ✅ ADDED: Live Device Action Counts
    const device_connect_count = 
      userLogs.filter((l) => l.action === "device_connect").length + 
      (action === "device_connect" ? 1 : 0);

    const device_disconnect_count = 
      userLogs.filter((l) => l.action === "device_disconnect").length + 
      (action === "device_disconnect" ? 1 : 0);

    const device_activity_count = device_connect_count + device_disconnect_count;

    // 3. Derived Metrics
    
    // Total Activity (Updated to include all actions AND device activity)
    const total_activity = login_count + file_access_count + file_copy_count + removable_uploads + removable_downloads + device_activity_count;

    // Daily Averages
    const login_per_day = parseFloat((login_count / safe_days).toFixed(2));
    const activity_per_day = parseFloat((total_activity / safe_days).toFixed(2));
    const file_access_per_day = parseFloat((file_access_count / safe_days).toFixed(2));
    const file_copy_per_day = parseFloat((file_copy_count / safe_days).toFixed(2));
    const usb_upload_per_day = parseFloat((removable_uploads / safe_days).toFixed(2));
    const usb_download_per_day = parseFloat((removable_downloads / safe_days).toFixed(2));
    const device_connect_per_day = parseFloat((device_connect_count / safe_days).toFixed(2));
    const device_disconnect_per_day = parseFloat((device_disconnect_count / safe_days).toFixed(2));
    const decoy_access_per_day = parseFloat((decoy_access_count / safe_days).toFixed(2));

    // Actions Per Hour (Simple intensity metric)
    const actions_per_hour = userLogs.length + 1;

    // ✅ ADDED: Upload Ratio
    const upload_ratio = total_activity > 0 ? parseFloat((removable_uploads / total_activity).toFixed(4)) : 0;

    // ✅ ADDED: After Hours Activity (Check timestamps)
    // Checks if action is between 6 PM (18:00) and 6 AM (06:00)
    const currentHour = new Date().getHours();
    const isCurrentAfterHours = currentHour < 6 || currentHour >= 18;
    
    const previousAfterHours = userLogs.filter(l => {
        const h = new Date(l.createdAt).getHours();
        return h < 6 || h >= 18;
    }).length;
    
    const after_hours_activity = previousAfterHours + (isCurrentAfterHours ? 1 : 0);

    // 🚀 ADDED: Weekend Activity
    const currentDay = new Date().getDay();
    const isCurrentWeekend = currentDay === 0 || currentDay === 6; // 0 is Sunday, 6 is Saturday
    
    const previousWeekend = userLogs.filter(l => {
        const d = new Date(l.createdAt).getDay();
        return d === 0 || d === 6;
    }).length;
    
    const weekend_activity = previousWeekend + (isCurrentWeekend ? 1 : 0);

    // ✅ DEFAULTS for sophisticated metrics 
    // (These cannot be easily calculated from simple logs without 'pc' or 'filename' fields in schema)
    // We default them to safe values so the Python script doesn't crash.
    const unique_pcs = 1; 
    const active_hours = 0; // Kept in memory ONLY for the python command string
    const max_pcs_per_day = 1;
    const zip_file_count = 0;
    const total_lifetime_hours = 0;
    const avg_active_hours_per_day = 0;

    // ✅ ADDED: Safe defaults for complex device metrics
    const device_unique_pcs = 0;
    const device_after_hours = 0;
    const device_weekend_usage = 0;
    const avg_session_duration = 0;
    const device_usage_per_day = parseFloat((device_activity_count / safe_days).toFixed(2));
    const connect_disconnect_ratio = parseFloat((device_connect_count / (device_disconnect_count || 1)).toFixed(2));

    // ---------- ML PREDICTION ----------
    // Must match predict.py order: 
    // login, unique_pcs, active_hours, actions_hr, file_access, file_copy, 
    // uploads, downloads, decoy, max_pcs, after_hours, zip, ratio, 
    // NEW: days_active, role, user_id
    
    // Fallbacks for strings to prevent command line breaking if they are empty
    const safeRole = role ? role.replace(/\s+/g, '_') : "Unknown";
    const safeUserId = user_id ? user_id.replace(/\s+/g, '_') : "Unknown_User";
    const safeDaysActive = Math.max(1, days_active || 1); // Ensure it's never 0 or undefined

    const cmd = `python ml/predict.py ${login_count} ${unique_pcs} ${active_hours} ${actions_per_hour} ${file_access_count} ${file_copy_count} ${removable_uploads} ${removable_downloads} ${decoy_access_count} ${max_pcs_per_day} ${after_hours_activity} ${zip_file_count} ${upload_ratio} ${safeDaysActive} ${safeRole} ${safeUserId}`;

    exec(cmd, async (error, stdout, stderr) => {
      if (error) {
        console.error("Python error:", error);
        console.error("stderr:", stderr);
        return res.status(500).json({ error: error.message });
      }

      // Log stderr to Node console so you can see the Failsafe errors or the Success Summary
      if (stderr) {
        console.log("Python stderr:", stderr);
      }

      const prediction = stdout.trim(); // Python string output ("Normal" / "Anomaly")

      try {
        const log = new ActivityLog({
          user_id,
          employee_name: employee_name || "Unknown",
          role: role || "Unknown",
          email: email || "Unknown",
          action,
          
          // ✅ METRICS SAVED
          days_active,
          total_lifetime_hours,
          total_activity,
          
          login_count,
          login_per_day,
          unique_pcs,
          avg_active_hours_per_day,
          actions_per_hour,
          activity_per_day,
          
          file_access_count,
          file_copy_count,
          removable_uploads,
          removable_downloads,
          decoy_access_count,
          
          // ✅ EMAIL DEFAULT FIELDS
          email_sent_count: 0, 
          total_email_size: 0, 
          avg_email_size: 0,   
          attachment_count: 0, 

          // 🚀 ADVANCED BEHAVIOR METRICS SAVED
          after_hours_activity,
          weekend_activity,

          // ✅ DEVICE METRICS SAVED
          device_activity_count,
          device_connect_count,
          device_disconnect_count,
          device_unique_pcs,
          device_after_hours,
          device_weekend_usage,
          connect_disconnect_ratio,
          avg_session_duration,
          device_usage_per_day,

          // 📊 NEW DAILY RATE METRICS
          file_access_per_day,
          file_copy_per_day,
          email_sent_per_day: 0,
          usb_upload_per_day,
          usb_download_per_day,
          device_connect_per_day,
          device_disconnect_per_day,
          decoy_access_per_day,

          // 📈 ROLLING WINDOWS & DRIFT METRICS
          window_7_days: 0,
          window_30_days: 0,
          baseline_90_days: 0,
          drift_7d_vs_30d: 0,
          drift_30d_vs_90d: 0,

          // 🚀 ML OUTPUT PLACEHOLDERS
          risk_score: 0,
          anomaly_score: 0,
          explanation: "",
          severity: "Low", // 🔥 STRICT ENUM DEFAULT
          
          // 🔥 Data Type Fix to Match Mongoose Schema
          prediction: prediction === "Anomaly" ? -1 : 1, // Store as Number
          prediction_label: prediction, // Store as String ("Normal" / "Anomaly")
          prediction_raw: prediction === "Anomaly" ? -1 : 1
        });

        await log.save();

        res.status(201).json(log);
      } catch (dbError) {
        console.error("DB error:", dbError);
        res.status(500).json({ error: dbError.message });
      }
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 });
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error fetching logs:", err);
    res.status(500).json({ error: err.message });
  }
};