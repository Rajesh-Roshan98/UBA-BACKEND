const User = require("../models/userModel");
const UserLog = require("../models/userLog");
const Alert = require("../models/Alert");
const Report = require("../models/Report");
const Session = require("../models/sessionModel");
const NodeCache = require("node-cache");

// 🔥 CACHE: Remembers individual user dashboards for 30 seconds
// stdTTL is slightly lower than admin to ensure they see their own actions quickly
const userCache = new NodeCache({ stdTTL: 30 });

/* ================= USER DASHBOARD ================= */

exports.getDashboardOverview = async (req, res) => {
  try {
    const userId = req.user.userId; 

    // 🔥 CACHE FIX: Check if we have this specific user's dashboard already calculated
    // We use the userId as the cache key so users don't see each other's data!
    const cacheKey = `userDash_${userId}`;
    const cachedDashboard = userCache.get(cacheKey);
    
    if (cachedDashboard) {
        return res.status(200).json(cachedDashboard); // Instant response!
    }

    // 1. Fetch user from MongoDB & get real-time UBA risk score
    // ✅ OPTIMIZED: Already using .select() and .lean()
    const user = await User.findById(userId).select("riskScore name").lean();

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
      // 🔥 OPTIMIZED: Added .select("location") to avoid fetching the full log object
      UserLog.findOne({ user: userId, action: "login", status: "success" })
        .sort({ createdAt: -1 })
        .select("location")
        .lean()
    ]);

    // Calculate active sessions directly from the Session database count.
    const activeSessions = Math.max(1, activeSessionsCount);

    // Fetch the device info from the specific Active Session rather than history
    // 🔥 OPTIMIZED: Added .select("deviceInfo") to only fetch the required string
    const currentSession = await Session.findOne({ 
      user: userId,
      token: req.token 
    }).select("deviceInfo").lean();

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

    // 🔥 CACHE FIX: Save the calculated dashboard data for this specific user
    userCache.set(cacheKey, dashboardData);

    res.status(200).json(dashboardData);
  } catch (error) {
    console.error(`[📊 DASHBOARD ERROR] Failed to calculate user dashboard overview: ${error.message}`, error);
    res.status(500).json({ message: "Error retrieving dashboard analytics from database" });
  }
};

/* ================= USER ALERT ================= */

exports.getAlerts = async (req, res) => {
  try {
    // 🔥 OPTIMIZED: Added .select() to only fetch the specific fields needed for the map below
    const alerts = await Alert.find({ user: req.user.userId })
      .select("title description severity status createdAt category")
      .sort({ createdAt: -1 })
      .lean();

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
    console.error(`[🚨 ALERTS FETCH ERROR] Failed to retrieve user alerts: ${error.message}`, error);
    res.status(500).json({ message: "Error retrieving security alerts" });
  }
};

exports.resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ OPTIMIZED: Added .lean() to the findOneAndUpdate
    const updatedAlert = await Alert.findOneAndUpdate(
      { _id: id, user: req.user.userId },
      { status: "resolved", resolvedAt: new Date() },
      { new: true }, 
    ).lean();

    if (!updatedAlert) {
      return res
        .status(404)
        .json({ message: "Alert not found or unauthorized" });
    }

    res
      .status(200)
      .json({ message: "Alert successfully resolved", alert: updatedAlert });
  } catch (error) {
    console.error(`[✅ ALERT RESOLVE ERROR] Failed to mark alert as resolved: ${error.message}`, error);
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
      // 🔥 OPTIMIZED: Added .select() to pull only needed fields
      const log = await UserLog.findOne({ _id: id, user: userId })
        .select("deviceInfo device location createdAt details")
        .lean();
        
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
    // ✅ OPTIMIZED: Added .lean()
    const failedLogs = await UserLog.find({ 
      user: userId, 
      status: 'failed' 
    }).sort({ createdAt: -1 }).lean();

    res.status(200).json({
      success: true,
      count: failedLogs.length,
      data: failedLogs
    });
  } catch (error) {
    console.error(`[❌ FAILED LOGINS ERROR] Failed to fetch failed attempt logs: ${error.message}`, error);
    res.status(500).json({ success: false, message: "Error fetching failed logs" });
  }
};

/* ================= USER REPORT ================= */

exports.getReports = async (req, res) => {
  try {
    // 🔥 OPTIMIZED: Added .select() to only fetch required fields
    const reports = await Report.find({ user: req.user.userId })
      .select("name createdAt fileSize fileType url")
      .sort({ createdAt: -1 })
      .lean();

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
    console.error(`[📄 REPORTS FETCH ERROR] Failed to retrieve user reports: ${error.message}`, error);
    res.status(500).json({ message: "Error retrieving reports" });
  }
};

/* ================= USER ACTIVITY ================= */

exports.getUserLog = async (req, res) => {
  try {
    const userId = req.user.userId;
    // 🔥 FIX: Catch the timezone from the frontend, default to UTC if missing
    const userTz = req.query.tz || "UTC"; 
    const mongoose = require("mongoose"); // Ensure mongoose is required at the top of your file if not already

    // 1. Fetch Logs Grouped by Date using Aggregation
    const groupedLogs = await UserLog.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: {
            // 🔥 FIX: Tell MongoDB to group the dates using the user's actual local timezone
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: userTz },
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
      timeline: groupedLogs, // This is now date-wise based on local time!
      accessLogs 
    });
  } catch (error) {
    console.error(`[📜 ACTIVITY LOG ERROR] Failed to aggregate user activity timeline: ${error.message}`, error);
    res.status(500).json({ message: "Error retrieving activity monitor data" });
  }
};
