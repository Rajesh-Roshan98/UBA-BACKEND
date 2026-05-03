const mongoose = require("mongoose");

// Set strictQuery to true to prepare for Mongoose 7 changes
mongoose.set("strictQuery", true);

const connectWithRetry = async (retries = 5, delay = 3000) => {
  const DB_URL = process.env.DB_URL;
  if (!DB_URL) {
    console.error("❌ DB_URL is not defined in environment variables!");
    return;
  }

  // ✅ Reuse existing connection if already established
  if (mongoose.connection.readyState === 1) {
    console.log("✅ Already connected to DB");
    return;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(DB_URL, {
        serverSelectionTimeoutMS: 5000, // Fail early if it can't connect (5s instead of 30s)
        socketTimeoutMS: 45000,         // Close idle sockets after 45 seconds
        maxIdleTimeMS: 10000, 
      });
      console.log("✅ DB Connected Successfully");
      return;
    } catch (err) {
      console.error(`❌ DB connection attempt ${attempt} failed: ${err.message}`);
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        console.error("❌ All DB connection attempts failed!");
        // 🔥 IMPROVED: Server stays alive in degraded mode instead of crashing
        console.error("DB failed, running in degraded mode...");
      }
    }
  }
};

// ==========================================
// 🔥 NEW: CONNECTION EVENTS
// ==========================================
mongoose.connection.on("connected", () => {
  // Note: Omitted console.log here to avoid duplicating your existing "✅ DB Connected Successfully" log
});

mongoose.connection.on("disconnected", () => {
  console.log("🔴 MongoDB Disconnected (Network Dropped)");
});

mongoose.connection.on("reconnected", () => {
  console.log("🟡 MongoDB Reconnected (Network Restored)");
});

// 🔥 IMPROVED: EXPORT FLAG USING NATIVE MONGOOSE STATE
const getDBStatus = () => mongoose.connection.readyState === 1;

// ✅ Attach getDBStatus to the function to preserve your existing index.js import logic
module.exports = connectWithRetry;
module.exports.getDBStatus = getDBStatus;