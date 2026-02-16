const User = require("../models/userModel");
const ActivityLog = require("../models/ActivityLog");
const Permission = require("../models/PermissionModel"); // Ensure casing matches your file name

/* ================= DASHBOARD STATS ================= */
exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Total Users: Count unique user_ids in the logs (Real 4000 users)
    const distinctUsers = await ActivityLog.distinct("user_id");
    const totalUsers = distinctUsers.length;

    // 2. Active Sessions: Users active in the last 24h
    // Using updatedAt because createdAt is fixed in your model
    const activeSessionCount = (await ActivityLog.distinct("user_id", {
        updatedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })).length;

    // 3. Count Critical Alerts (Anomalies)
    const criticalAlerts = await ActivityLog.countDocuments({
        prediction: "Anomaly"
    });

    // 4. Anomaly Score: Percentage of total logs that are anomalous
    const totalLogs = await ActivityLog.countDocuments();
    const anomalyScore = totalLogs > 0 
        ? Math.round((criticalAlerts / totalLogs) * 100) 
        : 0;

    const dataTransferred = "2.4TB"; // Placeholder

    res.status(200).json({
      success: true,
      stats: {
        totalUsers,          // ✅ Shows 4000+
        activeSessions: activeSessionCount,
        criticalAlerts,
        dataTransferred,
        anomalyScore, 
        falsePositives: 3, 
        avgResponseTime: "2.3s"
      }
    });
  } catch (err) {
    console.error("DASHBOARD STATS ERROR:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ================= USER MANAGEMENT (FETCH FROM LOGS) ================= */
exports.getAllUsers = async (req, res) => {
  try {
    // 🔥 CORE CHANGE: Aggregate from ActivityLog, NOT User model.
    // This finds all unique users present in your dataset.
    
    const users = await ActivityLog.aggregate([
      // 1. Group by user_id to identify unique users
      {
        $group: {
          _id: "$user_id", // This is the email/ID string
          lastActive: { $max: "$updatedAt" }, // Find their most recent activity
          
          // Count anomalies for this specific user
          anomalyCount: { 
            $sum: { 
              $cond: [{ $eq: ["$prediction", "Anomaly"] }, 1, 0] 
            } 
          }
        }
      },
      // 2. Shape the data for the Frontend
      {
        $project: {
          id: "$_id",
          // Since logs don't have names, we use the ID/Email
          name: "$_id", 
          email: "$_id",
          
          // Default values (since logs don't have this info)
          role: "Detected User", 
          department: "External", 
          status: "active",
          accessLevel: "Low",
          
          // Dynamic Risk Score: 10 points per anomaly, max 100
          riskScore: { 
            $min: [ { $multiply: ["$anomalyCount", 10] }, 100 ] 
          },
          
          // Format Date for React
          lastActive: { 
            $dateToString: { format: "%Y-%m-%d %H:%M", date: "$lastActive" } 
          }
        }
      },
      // 3. Sort by highest risk first
      { $sort: { riskScore: -1 } } 
    ]);

    res.status(200).json({ success: true, users });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};

/* ================= UPDATE USER STATUS ================= */
// Note: This only updates registered users in the 'User' collection.
// It won't affect users purely found in logs (since they don't have a User document).
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, role } = req.body;
    
    const user = await User.findByIdAndUpdate(id, { status, role }, { new: true });
    
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({ success: true, message: "User updated", user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

/* ================= ACCESS CONTROL ================= */
exports.getPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find();
    
    // Mock data fallback if DB is empty
    if (permissions.length === 0) {
        return res.status(200).json({ success: true, permissions: [
            {
              id: 1,
              resource: 'Customer Database',
              user: 'john.doe@company.com',
              accessType: 'Read/Write',
              justification: 'Data analysis',
              grantedBy: 'admin@company.com',
              grantedDate: '2024-01-10',
              expiryDate: '2024-04-10',
              status: 'active'
            }
        ]});
    }
    res.status(200).json({ success: true, permissions });
  } catch (err) {
    console.error("GET PERMISSIONS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching permissions" });
  }
};

/* ================= GRANT ACCESS ================= */
exports.grantAccess = async (req, res) => {
  try {
    const { resource, userEmail, accessType, justification, expiryDate } = req.body;
    
    // Try to find user, or just proceed if granting to an external email
    let user = await User.findOne({ email: userEmail });
    const userId = user ? user._id : null; 

    // Create permission (even if user doesn't exist in User table yet, depending on schema requirements)
    // Note: permissionModel requires user_id. If user is null, this will fail unless schema is adjusted.
    if (!userId) return res.status(404).json({ success: false, message: "User must be registered to grant permissions" });

    const newPermission = await Permission.create({
        user_id: userId,
        resource,
        accessType,
        justification,
        grantedBy: "admin@company.com", 
        expiryDate,
        status: "active"
    });

    res.status(201).json({ success: true, message: "Access granted successfully", permission: newPermission });
  } catch (err) {
    console.error("GRANT ACCESS ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to grant access" });
  }
};