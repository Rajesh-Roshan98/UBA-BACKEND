const ActivityLog = require("../models/ActivityLog");

/* ================= GET SYSTEM LOGS ================= */
exports.getSystemLogs = async (req, res) => {
  try {
    const { search, level, component } = req.query;
    
    let query = {};

    // Filter Logic
    if (level && level !== 'all') query.level = level;
    if (component && component !== 'all') query.component = component;
     
    // Populate user to search by email
    let logs = await ActivityLog.find(query)
        .populate("user_id", "email")
        .sort({ createdAt: -1 })
        .limit(100); // Limit for performance

    // Search Logic (Basic in-memory or advanced Mongo regex)
    if (search) {
        const lowerSearch = search.toLowerCase();
        logs = logs.filter(log => 
            (log.message && log.message.toLowerCase().includes(lowerSearch)) ||
            (log.user_id && log.user_id.email.toLowerCase().includes(lowerSearch))
        );
    }

    // Map to frontend structure
    const formattedLogs = logs.map(log => ({
        id: log._id,
        timestamp: log.createdAt,
        level: log.level || "INFO", // Ensure ActivityLog schema has 'level'
        component: log.component || "System", // Ensure schema has 'component'
        message: `Action: ${log.action} | Prediction: ${log.prediction}`,
        user: log.user_id ? log.user_id.email : "system",
        ip: "192.168.1.1", // Requires IP field in schema
        sessionId: "SESS_" + log._id.toString().substring(0,6),
        details: log.details || "No additional details"
    }));

    res.status(200).json({ success: true, logs: formattedLogs });
  } catch (err) {
    console.error("SYSTEM LOGS ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to fetch logs" });
  }
};