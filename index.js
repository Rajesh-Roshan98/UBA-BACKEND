require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const UAParser = require("ua-parser-js");
const cookieParser = require('cookie-parser');

const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authRoutes");
const ubaRoutes = require("./routes/ubaRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const mlHealthCheck = require("./utils/mlHealthCheck");

const app = express();

/* ---------- CORS (AuthContext Support) ---------- */
app.use(
  cors({
    origin: ["http://localhost:5173", "http://10.145.13.199:5173", "http://10.65.142.199:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"], // 🔑 REQUIRED
    credentials: true,
  }), 
);

/* ---------- BODY PARSER ---------- */
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const parser = new UAParser(req.headers["user-agent"]);
  const ua = parser.getResult();

  // ------------------ DEVICE NORMALIZATION ------------------
  let deviceType = ua.device.type || "desktop";
  deviceType = deviceType.toLowerCase();
  if (deviceType === "mobile") deviceType = "Mobile";
  else if (deviceType === "tablet") deviceType = "Tablet";
  else deviceType = "Desktop";

  const browser = ua.browser.name || "Unknown Browser";

  // ------------------ OS NORMALIZATION ------------------
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

  const deviceName = `${deviceType} (${browser} on ${osName})`;

  // ------------------ IP & TIME ------------------
  const ip = (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    req.ip
  )
    .split(",")[0]
    .trim();

  // ✅ Format timestamp as DD/MM/YYYY, hh:mm:ss AM/PM
  const now = new Date().toLocaleString("en-GB", { hour12: true });

  // ✅ Single-line log
  console.log(`📱 ${deviceName} | 🌍 ${ip} | 🕒 ${now}`);

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
      app.listen(PORT, "0.0.0.0", () =>
        console.log(`🚀 Server running on port ${PORT}`),
      );
    })
    .catch((err) => {
      console.error("❌ DB Connection Error", err);
    });
}

module.exports = app;
