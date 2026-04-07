const fs = require('fs');
const path = require('path');
const User = require("../models/userModel");
const ActivityLog = require("../models/ActivityLog");
const Permission = require("../models/PermissionModel"); 
const NodeCache = require("node-cache");

// 🔥 CACHE: Remembers dashboard stats for 60 seconds to prevent server overload
const adminCache = new NodeCache({ stdTTL: 60 });

/* ================= DASHBOARD STATS ================= */
exports.getDashboardStats = async (req, res) => {
  try { 
    // 🔥 CACHE FIX: Check if we already calculated this recently
    const cachedStats = adminCache.get("dashboardStats");
    if (cachedStats) {
      return res.status(200).json(cachedStats); // Instant response!
    }

    // 1. Total Users (DB)
    const distinctUsers = await ActivityLog.distinct("user_id");
    const totalUsers = distinctUsers.length;

    // 2. Active Sessions (DB)
    const activeSessionCount = (await ActivityLog.distinct("user_id", {
        updatedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })).length;

    // 3. Count Anomalies (Robust Query - FIXED to handle numeric prediction and string prediction_label)
    const anomalyCount = await ActivityLog.countDocuments({
        $or: [
            { prediction_label: { $in: ["Anomaly", "anomaly", "ANOMALY", "Malicious"] } },
            { prediction: { $in: [-1] } },
            { prediction_raw: -1 }
        ]
    });

    // ---------------------------------------------------------
    // 4. DATA MONITORED (Dynamic - Reads ALL files in raw folder)
    // ---------------------------------------------------------
    let totalBytes = 0;
    const rawDataPath = path.join(__dirname, '../ml/data/raw');

    try {
        if (fs.existsSync(rawDataPath)) {
            const files = fs.readdirSync(rawDataPath); 
            files.forEach(file => {
                const filePath = path.join(rawDataPath, file);
                const stats = fs.statSync(filePath);
                totalBytes += stats.size;
            });
        }
    } catch (err) {
        console.error("Error reading raw data directory:", err.message);
    }

    let dataTransferred = "0 KB";
    if (totalBytes > 1073741824) dataTransferred = (totalBytes / 1073741824).toFixed(2) + " GB";
    else if (totalBytes > 1048576) dataTransferred = (totalBytes / 1048576).toFixed(2) + " MB";
    else dataTransferred = (totalBytes / 1024).toFixed(2) + " KB";

    // ---------------------------------------------------------
    // 5. MODEL ACCURACY (Calculated from MongoDB)
    // ---------------------------------------------------------
    const totalLogs = await ActivityLog.countDocuments();
    let modelAccuracy = "0%";

    if (totalLogs > 0) {
        const normalCount = totalLogs - anomalyCount;
        const accuracyVal = (normalCount / totalLogs) * 100;
        modelAccuracy = accuracyVal.toFixed(1) + "%"; 
    }

    const responsePayload = {
      success: true,
      stats: {
        totalUsers,          
        activeSessions: activeSessionCount,
        
        // --- KEY MAPPING FOR FRONTEND ---
        totalAnomalies: anomalyCount, 
        anomaliesToday: anomalyCount, 
        anomalyScore: anomalyCount,   
        
        // --- DATA & ACCURACY ---
        dataTransferred,     
        modelAccuracy       
      }
    };

    // 🔥 CACHE FIX: Save the hard math we just did for the next 60 seconds
    adminCache.set("dashboardStats", responsePayload);

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error("DASHBOARD STATS ERROR:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ================= USER MANAGEMENT (FETCH FROM LOGS) ================= */
exports.getAllUsers = async (req, res) => {
  try {
    const users = await ActivityLog.aggregate([
      {
        $group: {
          _id: "$user_id", 
          lastActive: { $max: "$updatedAt" }, 
          anomalyCount: { 
            $sum: { 
              $cond: [
                { 
                  $or: [
                    // ✅ FIXED: Using prediction_label for strings, prediction for numbers
                    { $in: ["$prediction_label", ["Anomaly", "anomaly", "Malicious"]] },
                    { $eq: ["$prediction", -1] },
                    { $eq: ["$prediction_raw", -1] }
                  ]
                }, 
                1, 
                0
              ] 
            } 
          }
        }
      },
      {
        $project: {
          id: "$_id",
          name: "$_id", 
          email: "$_id",
          role: "Detected User", 
          department: "External", 
          status: "active",
          accessLevel: "Low",
          riskScore: { 
            $min: [ { $multiply: ["$anomalyCount", 10] }, 100 ] 
          },
          lastActive: { 
            $dateToString: { format: "%Y-%m-%d %H:%M", date: "$lastActive" } 
          }
        }
      },
      { $sort: { riskScore: -1 } } 
    ]);

    res.status(200).json({ success: true, users });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
};

/* ================= UPDATE USER STATUS ================= */
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, role } = req.body;
    
    // ✅ OPTIMIZED: Added .lean() 
    // 🔥 OPTIMIZED: Added .select("_id") because we don't need to download the entire updated profile
    const user = await User.findByIdAndUpdate(id, { status, role }, { new: true }).select("_id").lean();
    
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.status(200).json({ success: true, message: "User updated", user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

/* ================= ACCESS CONTROL ================= */
exports.getPermissions = async (req, res) => {
  try {
    // ✅ OPTIMIZED: Added .lean()
    // Intentionally omitting .select() so the frontend receives the full table data
    const permissions = await Permission.find().lean();
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
    
    // ✅ OPTIMIZED: Added .lean()
    // 🔥 OPTIMIZED: Added .select("_id") to find the user instantly without downloading their profile
    let user = await User.findOne({ email: userEmail }).select("_id").lean();
    const userId = user ? user._id : null; 
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