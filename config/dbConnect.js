const mongoose = require("mongoose");

const connectWithRetry = async (retries = 5, delay = 3000) => {
  const DB_URL = process.env.DB_URL;
  if (!DB_URL) {
    console.error("❌ DB_URL is not defined in environment variables!");
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
        process.exit(1);
      }
    }
  }
};

module.exports = connectWithRetry;
