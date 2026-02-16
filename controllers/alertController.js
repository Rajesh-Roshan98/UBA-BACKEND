const ActivityLog = require("../models/ActivityLog");

/* ================= GET ALERTS ================= */
exports.getAlerts = async (req, res) => {
  try {
    const { severity, status } = req.query;
    let query = { prediction: "Malicious" }; // Default to malicious logs as alerts

    if (severity && severity !== 'all') query.severity = severity;
    if (status && status !== 'all') query.status = status;

    const logs = await ActivityLog.find(query)
      .populate("user_id", "email firstName lastName")
      .sort({ createdAt: -1 });

    // Map to frontend structure
    const alerts = logs.map(log => ({
      id: log._id,
      title: log.action.toUpperCase() + " Detected",
      description: `Anomaly detected with prediction score: ${log.prediction}`,
      severity: log.severity || "high",
      user: log.user_id ? log.user_id.email : "Unknown",
      timestamp: log.createdAt,
      source: "UBA Model",
      status: log.status || "open", // You need to add 'status' field to ActivityLog schema
      assignedTo: "Security Team"
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
    const { status } = req.body; // 'resolved', 'closed', 'false-positive'

    const log = await ActivityLog.findByIdAndUpdate(id, { status }, { new: true });
    
    if (!log) return res.status(404).json({ success: false, message: "Alert not found" });

    res.status(200).json({ success: true, message: `Alert marked as ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

/* ================= GET ANOMALIES FOR REVIEW ================= */
exports.getAnomalies = async (req, res) => {
  try {
    // Similar to alerts but specifically for the 'AnomalyReview' page
    // fetching pending items
    const anomalies = await ActivityLog.find({ 
        prediction: "Malicious", 
        status: { $in: ["pending", "investigating"] } 
    }).populate("user_id");

    const formatted = anomalies.map(a => ({
        id: a._id,
        type: a.action,
        user: a.user_id?.email,
        score: Math.floor(Math.random() * (100 - 60) + 60), // Mock score if not in DB
        confidence: 85,
        description: "Unusual behavior pattern detected",
        timestamp: a.createdAt,
        status: a.status || "pending",
        details: { action_count: a.actions_per_hour, login_count: a.login_count }
    }));

    res.status(200).json({ success: true, anomalies: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching anomalies" });
  }
};