require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const UAParser = require("ua-parser-js");
const cookieParser = require('cookie-parser');
const compression = require("compression"); // 🔥 NEW: Import compression for payload optimization

const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authRoutes");
const ubaRoutes = require("./routes/ubaRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const mlHealthCheck = require("./utils/mlHealthCheck");

const app = express();

/* ---------- CORS (AuthContext Support) ---------- */
// 🔥 NEW: Read allowed origins dynamically from your .env file
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim().replace(/\/$/, '')) 
  : ["http://localhost:5173"];

// Debug log to verify what the server is actually seeing
console.log("✅ Allowed CORS Origins:", allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like Postman or mobile apps)
      if (!origin) return callback(null, true);
      
      // Check if the incoming origin is in our cleaned array
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.error(`🚫 Blocked by CORS: Origin '${origin}' is not in the allowed list.`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"], // 🔑 REQUIRED
    credentials: true,
  })
);

/* ---------- PERFORMANCE OPTIMIZATION ---------- */
// 🔥 NEW: Compress all responses to reduce payload size (speeds up network transfer by up to 70%)
app.use(compression());

/* ---------- BODY PARSER ---------- */
app.use(express.json());
app.use(cookieParser());

// ✅ PERFORMANCE IMPROVEMENTS:
// - UA parsing (CPU-heavy) only runs for login requests
// - Console logging disabled in production
app.use((req, res, next) => {
  let deviceName = "Unknown Device";
  let ip, now;

  // Extract IP and timestamp (always needed)
  ip = (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    req.ip
  )
    .split(",")[0]
    .trim();
  now = new Date().toLocaleString("en-GB", { hour12: true });

  // ✅ Only parse user agent for login requests
  if (req.path.includes("/login")) {
    const parser = new UAParser(req.headers["user-agent"]);
    const ua = parser.getResult();

    // Device type normalization
    let deviceType = ua.device.type || "desktop";
    deviceType = deviceType.toLowerCase();
    if (deviceType === "mobile") deviceType = "Mobile";
    else if (deviceType === "tablet") deviceType = "Tablet";
    else deviceType = "Desktop";

    const browser = ua.browser.name || "Unknown Browser";

    // OS normalization
    let osName = ua.os.name || "Unknown OS";
    const osMap = {
      "Windows NT": "Windows",
      "Mac OS X": "Mac",
      MacOS: "Mac",
      Android: "Android",
      iOS: "iOS",
      Linux: "Linux",
    };
    for (const key in osMap) {
      if (osName.includes(key)) {
        osName = osMap[key];
        break;
      }
    }
    deviceName = `${deviceType} (${browser} on ${osName})`;
  }

  // ✅ Log only in development / non-production environments
  if (process.env.NODE_ENV !== "production") {
    // 👇 COMMENTED OUT: Prevents duplicate terminal logs (logger.js handles this beautifully now!)
    // console.log(`📱 ${deviceName} | 🌍 ${ip} | 🕒 ${now}`);
  }

  next();
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
/* ---------- BASIC ROUTES ---------- */
app.get("/favicon.ico", (_, res) => res.sendStatus(204));

app.get("/", (_, res) => {
  res.status(200).send("API is running ✅");
});

/* ---------- HEALTH CHECK ---------- */
app.get("/health", (_, res) => {
  const dbStatus = mongoose.connection.readyState;

  if (dbStatus === 1) {
    return res.status(200).json({
      server: "Running",
      database: "Connected",
      timestamp: new Date(),
    });
  }

  return res.status(500).json({
    server: "Running",
    database: "Disconnected",
    status_code: dbStatus,
  });
});

/* ---------- ROUTES ---------- */
app.use("/api/v1", authRouter); // 🔑 AuthContext uses this
app.use("/api/uba", ubaRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/user", userRoutes);

/* ---------- SERVER START ---------- */
if (require.main === module) {
  dbConnect()
    .then(async () => {
      try {
        await mlHealthCheck();
      } catch {
        console.error("🚨 ML is NOT ready.");
      }

      const PORT = process.env.PORT || 3000;
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Server running on port ${PORT}`);
        // 🔥 Added some helpful terminal logs so you can click them easily!
        console.log(`➜  Local:   http://localhost:${PORT}`);
        console.log(`➜  Network: http://10.186.34.199:${PORT} (or your current LAN IP)`);
      });
    })
    .catch((err) => {
      console.error("❌ DB Connection Error", err);
    });
}

module.exports = app;
