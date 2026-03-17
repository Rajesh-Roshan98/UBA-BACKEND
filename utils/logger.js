const UserLog = require("../models/userLog"); // Adjust path if necessary
const AdminLog = require("../models/adminLog"); // 🔥 NEW: Imported AdminLog model
const UAParser = require("ua-parser-js");
const axios = require("axios");

/**
 * Extracts device and location info from the Express request object
 */
const getDeviceInfo = async (req) => {
  if (!req) return { deviceName: "Unknown", locationString: "Unknown" };

  const userAgent = req.headers["user-agent"] || "";
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  // ✅ UPDATED DEVICE DETECTION (No working logic changed)
  const deviceType = result.device.type; // mobile | tablet | undefined
  const deviceOS = result.os.name || "Unknown OS";
  const browser = result.browser.name || "Unknown Browser";

  let deviceName = `${deviceOS} ${browser}`.trim(); // default (desktop)

  if (deviceType === "mobile") {
    deviceName = `${browser} on ${deviceOS}`;
  } else if (deviceType === "tablet") {
    deviceName = `Tablet ${browser} on ${deviceOS}`;
  } 
  // 🔥 Fallback detection if UAParser fails (important for new Chrome versions)
  else if (
    userAgent.toLowerCase().includes("android") ||
    userAgent.toLowerCase().includes("iphone") ||
    userAgent.toLowerCase().includes("ipad") ||
    userAgent.toLowerCase().includes("mobile")
  ) {
    deviceName = `Mobile ${browser} on ${deviceOS}`;
  }

  // 🔥 IMPROVED: Check multiple headers to find the real public IP
  const ipAddress = 
    req.headers["x-forwarded-for"]?.split(',')[0].trim() || 
    req.headers["x-real-ip"] || 
    req.socket?.remoteAddress || 
    "";

  let locationString = "Unknown";

  try {
    let fetchIp = ipAddress;
    
    if (fetchIp.includes('::1') || fetchIp.includes('127.0.0.1') || !fetchIp) {
      fetchIp = ''; 
    }
    
    const geoRes = await axios.get(`http://ip-api.com/json/${fetchIp}`);
    
    if (geoRes.data && geoRes.data.status === 'success') {
      const city = geoRes.data.city || "Unknown City";
      const state = geoRes.data.regionName || "Unknown State";
      locationString = `${city}, ${state}`;
    }
  } catch (geoError) {
    console.error("GeoIP Fetch Error:", geoError.message);
  }

  return { deviceName, locationString };
};

/**
 * Reusable function to log user activity anywhere in the app
 */
// 🔥 NEW: Added adminId, role, and email to the destructured parameters
const logActivity = async ({ userId, adminId, role, email, action, category, details, status = "success", req = null }) => {
  try {
    let device = "Unknown";
    let location = "Unknown";

    if (req) {
      const info = await getDeviceInfo(req);
      device = info.deviceName;
      location = info.locationString;
    }

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN LOGGING LOGIC
    // ==========================================
    if (role === "admin" || adminId) {
      await AdminLog.create({
        admin: adminId || userId, // Fallback to userId if it was passed generically by mistake
        email, // 🔥 ADDED: include email to satisfy schema requirement
        action,
        category,
        details,
        status,
        location,
        device
      });
      return; // Stop execution here so it doesn't duplicate the log in UserLog
    }
    // ==========================================

    // EXISTING LOGIC (Untouched)
    await UserLog.create({
      user: userId,
      email, // 🔥 ADDED: include email to satisfy schema requirement
      action,
      category,
      details,
      status,
      location,
      device
    });
  } catch (error) {
    console.error(`Failed to log activity (${action}):`, error);
  }
};

module.exports = { logActivity, getDeviceInfo };