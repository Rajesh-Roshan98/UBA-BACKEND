const ActivityLog = require("../models/ActivityLog");
const { exec } = require("child_process");

exports.createLog = async (req, res) => {
  try {
    const { user_id, action } = req.body;

    if (!user_id || !action) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Fetch existing logs for this user
    const userLogs = await ActivityLog.find({ user_id });

    // ---------- FEATURE CALCULATIONS (UNCHANGED) ----------
    const actions_per_hour = userLogs.length + 1;

    const login_count =
      userLogs.filter((l) => l.action === "login").length +
      (action === "login" ? 1 : 0);

    const file_access_count =
      userLogs.filter((l) => l.action === "file_access").length +
      (action === "file_access" ? 1 : 0);

    const decoy_access_count =
      userLogs.filter((l) => l.action === "decoy_file").length +
      (action === "decoy_file" ? 1 : 0);

    // ---------- ML PREDICTION ----------
    const cmd = `python ml/predict.py ${actions_per_hour} ${login_count} ${file_access_count} ${decoy_access_count}`;

    exec(cmd, async (error, stdout, stderr) => {
      if (error) {
        console.error("Python error:", error);
        console.error("stderr:", stderr);
        return res.status(500).json({ error: error.message });
      }

      const prediction = stdout.trim();

      try {
        // 🔥 IMPORTANT CHANGE:
        // Use new + save() instead of create()
        const log = new ActivityLog({
          user_id,
          action,
          actions_per_hour,
          login_count,
          file_access_count,
          decoy_access_count,
          prediction
        });

        await log.save(); // ✅ triggers schema timestamp logic

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
