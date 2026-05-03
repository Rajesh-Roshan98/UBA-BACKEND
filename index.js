require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const UAParser = require("ua-parser-js");
const cookieParser = require('cookie-parser');
const compression = require("compression"); // 🔥 NEW: Import compression for payload optimization
const helmet = require("helmet"); // 🔥 FIX 3: Import helmet for security headers

const http = require("http"); // 🔥 NEW: Import http for Socket.io
const { initSocket } = require("./utils/socketConfig"); // 🔥 NEW: Import socket configuration

// 🔥 NEW: Import your rate limiters and initializer
const { initRedisLimiter, globalLimiter } = require("./middleware/rateLimiter"); // Adjust path if necessary

const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authRoutes");
const ubaRoutes = require("./routes/ubaRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const mlHealthCheck = require("./utils/mlHealthCheck");

const app = express();
const server = http.createServer(app); // 🔥 NEW: Wrap express in HTTP server

// 🔥 NEW: Trust reverse proxy (e.g., Vite, Nginx, Vercel) to ensure req.ip accurately reflects the user, not the proxy
app.set("trust proxy", 1);

// 🔥 THE FIX: Apply helmet with Cross-Origin Policy to allow frontend to load avatars
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

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
// 🔥 FIX 2: Added 10kb payload limit to prevent DoS attacks via massive JSON payloads
app.use(express.json({ limit: "10kb" }));
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
// 🔥 NEW: Apply the global rate limiter as a fallback for all API routes
app.use("/api", globalLimiter);

app.use("/api/v1/auth", authRouter); 
app.use("/api/v1/uba", ubaRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/user", userRoutes);

// 🔥 FIX 4: Global Error Handling Middleware (Catches unhandled errors gracefully)
app.use((err, req, res, next) => {
  console.error("Global Error Caught:", err);
  res.status(500).json({
    success: false,
    message: "Internal Server Error"
  });
});

/* ---------- SERVER START ---------- */
if (require.main === module) {
  // 🔥 FIX: Wrap startup in an async function to guarantee Redis connects first
  const startServer = async () => {
    try {
      // 1. Wait for Redis Limiter to initialize
      await initRedisLimiter();
      console.log("✅ Rate limiters initialized.");
    } catch (err) {
      console.error("❌ Failed to initialize rate limiters:", err);
    }

    // 2. Connect to the database and start the server ONLY after Redis is ready
    dbConnect()
      .then(async () => {
        try {
          await mlHealthCheck();
        } catch {
          console.error("🚨 ML is NOT ready.");
        }

        const PORT = process.env.PORT || 3000;
        
        // 🔥 INDUSTRY STANDARD FIX: Initialize Socket.io only AFTER the database is fully connected
        initSocket(server); 

        // 🔥 THE FIX: Changed app.listen to server.listen so Socket.io works properly
        server.listen(PORT, "0.0.0.0", () => {
          console.log(`🚀 Server running on port ${PORT}`);
          // 🔥 Added some helpful terminal logs so you can click them easily!
          console.log(`➜  Local:   http://localhost:${PORT}`);
          console.log(`➜  Network: http://10.213.153.199:${PORT} (or your current LAN IP)`);
        });
      })
      .catch((err) => {
        console.error("❌ DB Connection Error", err);
      });
  };

  startServer();
}

// 🔥 TRUE GRACEFUL SHUTDOWN
process.on("SIGINT", async () => {
  console.log("🛑 Server shutting down gracefully...");

  try {
    // 1. Close MongoDB connection cleanly
    await mongoose.connection.close();
    console.log("✅ MongoDB disconnected");

    // 2. Stop accepting new HTTP/Socket requests and allow current ones to finish
    server.close(() => {
      console.log("✅ HTTP server closed");
      process.exit(0);
    });

  } catch (err) {
    console.error("❌ Shutdown error:", err);
    process.exit(1);
  }
});

module.exports = app;