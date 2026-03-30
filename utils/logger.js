const UserLog = require("../models/userLog"); // Adjust path if necessary
const AdminLog = require("../models/adminLog"); // 🔥 NEW: Imported AdminLog model
const UAParser = require("ua-parser-js");
const axios = require("axios");

/**
 * Extracts device and location info from the Express request object
 */
const getDeviceInfo = async (req) => {
  if (!req) {
    return { deviceName: "Unknown", locationString: "Unknown" };
  }

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
  const ipAddress = (
    req.headers["x-forwarded-for"] || 
    req.headers["x-real-ip"] || 
    req.socket?.remoteAddress || 
    req.ip ||
    ""
  ).split(',')[0].trim();

  let locationString = "Unknown";

  try {
    let fetchIp = ipAddress;
    
    // 1. Strip out IPv6 wrapping (turns ::ffff:10.x.x.x into 10.x.x.x)
    if (fetchIp.startsWith('::ffff:')) {
      fetchIp = fetchIp.replace('::ffff:', '');
    }
    
    // 2. Check for all local IP variations
    if (fetchIp === '::1' || fetchIp === '127.0.0.1' || fetchIp.startsWith('10.') || fetchIp.startsWith('192.168.') || !fetchIp) {
      fetchIp = ''; 
    }

    // 🔥 FIX 1: Bumped timeout to 3000ms for slower campus/public networks
    const geoRes = await axios.get(`http://ip-api.com/json/${fetchIp}`, { timeout: 3000 });
    
    if (geoRes.data && geoRes.data.status === 'success') {
      const city = geoRes.data.city || "Unknown City";
      const state = geoRes.data.regionName || "Unknown State";
      locationString = `${city}, ${state}`;
    } else if (geoRes.data && geoRes.data.status === 'fail') {
      // Catch ip-api.com specific errors (like private IP blocks)
      console.log(`⚠️ IP-API Error: ${geoRes.data.message}`);
    }
  } catch (geoError) {
    // 🔥 FIX 2: Stop silently ignoring errors so we can actually debug!
    if (geoError.code === 'ECONNABORTED') {
      console.log("⚠️ Location fetch timed out (network is too slow).");
    } else if (geoError.response && geoError.response.status === 429) {
      console.log("⚠️ Location fetch failed: Rate limited by ip-api.com (Too many requests).");
    } else {
      console.log(`⚠️ Location fetch failed: ${geoError.message}`);
    }
  }

  // 🔥 FORMATTED TERMINAL OUTPUT AS REQUESTED (Prints only the clean string)
  if (process.env.NODE_ENV !== "production") {
    const now = new Date().toLocaleString("en-GB", { hour12: true });
    console.log(`📱 ${deviceName} | 🌍 ${locationString} | 🕒 ${now}`);
  }

  return { deviceName, locationString };
};

/**
 * Reusable function to log user activity anywhere in the app
 */
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
        admin: adminId || userId,
        email, 
        action,
        category,
        details,
        status,
        location,
        device
      });
      return; 
    }
    // ==========================================

    // EXISTING LOGIC (Untouched)
    await UserLog.create({
      user: userId,
      email, 
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