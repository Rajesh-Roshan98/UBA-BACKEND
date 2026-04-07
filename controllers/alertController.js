const ActivityLog = require("../models/ActivityLog");

/* ================= GET ALERTS ================= */
exports.getAlerts = async (req, res) => {
  try {
    const { severity, status } = req.query;
    
    // ✅ FIXED: Updated to support the new numeric prediction and string prediction_label
    let query = { 
        $or: [ 
            { prediction_label: { $in: ["Anomaly", "anomaly", "Malicious"] } },
            { prediction: -1 },
            { prediction_raw: -1 }
        ]
    }; 

    if (severity && severity !== 'all') {
      query.severity = severity; 
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    // ✅ OPTIMIZED: Added .lean() 
    // 🔥 REVERTED: Removed .select() so your teacher can see ALL fields from the Kaggle dataset in the frontend
    const logs = await ActivityLog.find(query)
      .populate("user_id", "email firstName lastName")
      .sort({ createdAt: -1 })
      .lean();

    // Map to frontend structure
    // Note: Even though we map these specific fields for the 'alerts' array, 
    // the full 'logs' array is still available if you need to send it down differently later.
    const alerts = logs.map(log => ({
      id: log._id,
      title: log.action.replace(/_/g, ' ').toUpperCase() + " Detected",
      description: log.explanation || `Anomaly detected with prediction score: ${log.prediction}`,
      severity: log.severity ? log.severity.toLowerCase() : "high", 
      user: log.user_id ? log.user_id : "Unknown",
      timestamp: log.createdAt,
      source: "UBA Model",
      status: log.status || "open",
      assignedTo: "Security Team",
      riskScore: log.risk_score,
      // ✅ ADDED: New device metrics for detailed alert drill-down
      device_connect_count: log.device_connect_count || 0,
      device_disconnect_count: log.device_disconnect_count || 0,
      avg_session_duration: log.avg_session_duration || 0,
      device_unique_pcs: log.device_unique_pcs || 0,
      device_after_hours: log.device_after_hours || 0,
      device_weekend_usage: log.device_weekend_usage || 0,
      connect_disconnect_ratio: log.connect_disconnect_ratio || 0,
      
      // 🔥 CRITICAL ADDITION: We spread the rest of the raw log data into the object 
      // so the frontend has access to ALL original Kaggle columns!
      ...log 
    }));

    res.status(200).json({ success: true, alerts });
  } catch (err) {
    console.error("GET ALERTS ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to fetch alerts" });
  }
};

/* ================= MANAGE ALERTS ================= */
exports.updateAlertStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; 

    // ✅ OPTIMIZED: Added .lean() 
    // 🔥 OPTIMIZED: Added .select("_id") because we don't need the full document back just to send a success message
    const log = await ActivityLog.findByIdAndUpdate(id, { status }, { new: true }).select("_id").lean();
    
    if (!log) return res.status(404).json({ success: false, message: "Alert not found" });

    res.status(200).json({ success: true, message: `Alert marked as ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

/* ================= GET ANOMALIES FOR REVIEW ================= */
exports.getAnomalies = async (req, res) => {
  try {
    // ✅ FIXED: Updated to support the new numeric prediction and string prediction_label
    // ✅ OPTIMIZED: Added .lean() 
    // 🔥 REVERTED: Removed .select() so the frontend receives the full objects
    const anomalies = await ActivityLog.find({ 
        $or: [
            { prediction_label: { $in: ["Anomaly", "anomaly", "Malicious"] } },
            { prediction: -1 },
            { prediction_raw: -1 }
        ],
        status: { $in: ["pending", "investigating", null, "open"] } 
    })
    .populate("user_id", "email")
    .lean();

    // 🔹 UPDATED: Strictly mapping only the fields you requested for the Anomaly Review page
    const formatted = anomalies.map(a => ({
        id: a._id,
        anomaly: a.action.replace(/_/g, ' ').toUpperCase(), // Formatted action name
        email: a.email !== "Unknown" ? a.email : (a.user_id?.email || a.user_id || "Unknown"), // Prioritize stored email
        reason: a.explanation || "Unusual behavior pattern detected",
        riskScore: a.risk_score || 0,
        status: a.status || "open",
        timestamp: a.createdAt, // Kept because frontend tables need a date/key
        // ✅ ADDED: New device metrics for anomaly investigation panel
        device_connect_count: a.device_connect_count || 0,
        device_disconnect_count: a.device_disconnect_count || 0,
        avg_session_duration: a.avg_session_duration || 0,
        device_unique_pcs: a.device_unique_pcs || 0,
        device_after_hours: a.device_after_hours || 0,
        device_weekend_usage: a.device_weekend_usage || 0,
        connect_disconnect_ratio: a.connect_disconnect_ratio || 0,
        
        // 🔥 CRITICAL ADDITION: Spread the rest of the raw data so no columns are lost!
        ...a
    }));

    res.status(200).json({ success: true, anomalies: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching anomalies" });
  }
};