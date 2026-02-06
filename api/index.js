const app = require("../index");
const dbConnect = require("../config/dbConnect");

let isConnected = false;

module.exports = async (req, res) => {
  
  if (!isConnected) {
    try {
      await dbConnect();
      isConnected = true;
      console.log("✅ MongoDB connected via Vercel Function");
    } catch (error) {
      console.error("❌ DB Connection Error:", error);
      return res.status(500).send("Database Connection Failed");
    }
  }

  return app(req, res);
};