const User = require("../models/userModel");
const UserLog = require("../models/userLog");
const Alert = require("../models/Alert");
const Report = require("../models/Report");
const Session = require("../models/sessionModel");

/* ================= USER DASHBOARD ================= */

exports.getDashboardOverview = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Fetch user from MongoDB & get real-time UBA risk score
    const user = await User.findById(userId).select("riskScore name");

    if (!user) {
      return res.status(404).json({ message: "User not found in database." });
    }

    // Calculate exactly 24 hours ago (matches your JWT '1d' expiry)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 2. Run parallel MongoDB queries to count live statistics
    const [dataAccessCount, totalLogins, failedAttempts, activeSessionsCount, latestLoginLog] = await Promise.all([
      // Counts how many times this user accessed data
      UserLog.countDocuments({ user: userId, category: "data_access" }),
      
      // Counts successful logins
      UserLog.countDocuments({
        user: userId,
        action: "login",
        status: "success",
      }),
      
      // Counts failed login attempts
      UserLog.countDocuments({
        user: userId,
        action: "login",
        status: "failed",
      }),

      // Count real-time sessions directly from the new Session collection
      Session.countDocuments({ user: userId }),

      // 🔥 NEW: Fetch the most recent successful login log to get the location
      UserLog.findOne({ user: userId, action: "login", status: "success" }).sort({ createdAt: -1 })
    ]);

    // Calculate active sessions directly from the Session database count.
    const activeSessions = Math.max(1, activeSessionsCount);

    // Fetch the device info from the specific Active Session rather than history
    const currentSession = await Session.findOne({ 
      user: userId,
      token: req.token 
    });

    let deviceName = "Unknown Device";
    if (currentSession && currentSession.deviceInfo) {
      const match = currentSession.deviceInfo.match(/\[Device:\s*(.*?)\s*\|/);
      if (match) {
        deviceName = match[1].trim(); 
      }
    }

    let cityName = "Unknown Location";
    if (latestLoginLog && latestLoginLog.location && latestLoginLog.location !== "Unknown") {
      cityName = latestLoginLog.location.split(',')[0].trim(); 
    }

    // Combines them into the exact format for the frontend
    const sessionExtraInfo = `\n(${deviceName}, ${cityName})`;

    // 3. Format response to match your React component's exact expected shape
    const dashboardData = {
      riskScore: user.riskScore || 0, 
      stats: [
        { label: "Data Access", value: (dataAccessCount || 0).toLocaleString() },
        { label: "Total Logins", value: (totalLogins || 0).toLocaleString() },
        { label: "Failed Attempts", value: (failedAttempts || 0).toString() },
        { label: "Active Sessions", value: `${activeSessions}${sessionExtraInfo}` }, 
      ],
    };

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error("MongoDB Dashboard Error:", error);
    res.status(500).json({ message: "Error retrieving dashboard analytics from database" });
  }
};

/* ================= USER ALERT ================= */

exports.getAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find({ user: req.user.userId }).sort({
      createdAt: -1,
    });

    const formattedAlerts = alerts.map((alert) => ({
      id: alert._id,
      title: alert.title,
      description: alert.description,
      severity: alert.severity, 
      status: alert.status, 
      time: alert.createdAt, 
      category: alert.category,
    }));

    res.status(200).json(formattedAlerts);
  } catch (error) {
    console.error("Alerts Error:", error);
    res.status(500).json({ message: "Error retrieving security alerts" });
  }
};

exports.resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedAlert = await Alert.findOneAndUpdate(
      { _id: id, user: req.user.userId },
      { status: "resolved", resolvedAt: new Date() },
      { new: true }, 
    );

    if (!updatedAlert) {
      return res
        .status(404)
        .json({ message: "Alert not found or unauthorized" });
    }

    res
      .status(200)
      .json({ message: "Alert successfully resolved", alert: updatedAlert });
  } catch (error) {
    console.error("Resolve Alert Error:", error);
    res.status(500).json({ message: "Error updating alert status" });
  }
};

/* ================= FAILED EMAIL / ACTIVITY DETAILS ================= */

exports.getFailedAttempts = async (req, res) => {
  try {
    const { id } = req.query; // Check if a specific alertId was passed
    const userId = req.user.userId;

    // If an ID is provided, fetch that specific log (used by the CheckActivity page)
    if (id) {
      const log = await UserLog.findOne({ _id: id, user: userId });
      if (!log) return res.status(404).json({ success: false, message: "Log not found" });

      // Return data in the shape the React frontend expects
      return res.status(200).json({
        name: req.user.name || "User",
        email: req.user.email || "Protected",
        device: log.deviceInfo || "Unknown Device",
        location: log.location || "Unknown Location",
        time: log.createdAt,
        reason: log.details || "Incorrect Password"
      });
    }

    // Otherwise, return the list of all failed logs for this user
    const failedLogs = await UserLog.find({ 
      user: userId, 
      status: 'failed' 
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: failedLogs.length,
      data: failedLogs
    });
  } catch (error) {
    console.error("Failed Attempts Error:", error);
    res.status(500).json({ success: false, message: "Error fetching failed logs" });
  }
};

/* ================= USER REPORT ================= */

exports.getReports = async (req, res) => {
  try {
    const reports = await Report.find({ user: req.user.userId }).sort({
      createdAt: -1,
    });

    const formattedReports = reports.map((report) => ({
      id: report._id,
      name: report.name,
      date: report.createdAt,
      size: report.fileSize, 
      type: report.fileType, 
      downloadUrl: report.url, 
    }));

    res.status(200).json(formattedReports);
  } catch (error) {
    console.error("Reports Error:", error);
    res.status(500).json({ message: "Error retrieving reports" });
  }
};

/* ================= USER ACTIVITY ================= */

exports.getUserLog = async (req, res) => {
  try {
    const userId = req.user.userId;
    const mongoose = require("mongoose"); // Ensure mongoose is required at the top of your file if not already

    // 1. Fetch Logs Grouped by Date using Aggregation
    const groupedLogs = await UserLog.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          events: {
            $push: {
              logId: "$_id",
              action: "$action",
              category: "$category",
              details: "$details",
              status: "$status",
              resourceName: "$resourceName",
              resourceType: "$resourceType",
              location: "$location",
              device: "$device",
              timestamp: "$createdAt",
            },
          },
        },
      },
      { $sort: { _id: -1 } }, // Sort dates newest first
      {
        $project: {
          _id: 0,
          date: "$_id",
          events: {
            $sortArray: { input: "$events", sortBy: { timestamp: -1 } }, // Sort events within date newest first
          },
        },
      },
    ]);

    // 2. Fetch Resource Usage (Kept from your original code)
    const resourceUsage = await UserLog.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId), resourceName: { $exists: true } } },
      {
        $group: {
          _id: "$resourceName",
          count: { $sum: 1 },
          lastAccessed: { $max: "$createdAt" },
          type: { $first: "$resourceType" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    const accessLogs = resourceUsage.map((resource) => ({
      resource: resource._id,
      type: resource.type,
      count: resource.count,
      last: resource.lastAccessed,
    }));

    // Return the new grouped logs alongside the resource usage
    res.status(200).json({ 
      timeline: groupedLogs, // This is now date-wise
      accessLogs 
    });
  } catch (error) {
    console.error("Activity Error:", error);
    res.status(500).json({ message: "Error retrieving activity monitor data" });
  }
};

/* ================= PUBLIC EMAIL ALERT ROUTES ================= */
// 🔥 NEW: These bypass auth by relying on the unguessable MongoDB _id of the UserLog

exports.getPublicAlertDetails = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ message: "Alert ID missing" });

    // Populate 'user' so we can get the name and email without needing a JWT
    const log = await UserLog.findById(id).populate("user", "firstName lastName email");

    if (!log) return res.status(404).json({ message: "Security log not found" });

    res.status(200).json({
      name: log.user ? `${log.user.firstName} ${log.user.lastName}` : "Unknown User",
      email: log.user ? log.user.email : "Protected",
      device: log.device || "Unknown Device", 
      location: log.location || "Unknown Location",
      time: log.createdAt,
      reason: log.details || "Multiple Failed Logins"
    });
  } catch (error) {
    console.error("Public Alert Details Error:", error);
    res.status(500).json({ message: "Server error fetching alert" });
  }
};

exports.acknowledgePublicAlert = async (req, res) => {
  try {
    const { id } = req.params;
    // Mark the UserLog as acknowledged to clear the alert state
    await UserLog.findByIdAndUpdate(id, { status: "acknowledged" });
    
    res.status(200).json({ message: "Activity acknowledged successfully" });
  } catch (error) {
    console.error("Public Alert Acknowledge Error:", error);
    res.status(500).json({ message: "Server error acknowledging alert" });
  }
};

exports.securePublicAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const log = await UserLog.findById(id);
    
    if (log && log.user) {
       // Log the user out of all active sessions to secure the account immediately
       await Session.deleteMany({ user: log.user });
       
       // Optional: You could also temporarily lock the account here if needed
       // await User.findByIdAndUpdate(log.user, { isEmailVerified: false });
    }
    
    res.status(200).json({ message: "Account secured successfully" });
  } catch (error) {
    console.error("Public Alert Secure Error:", error);
    res.status(500).json({ message: "Server error securing account" });
  }
};

