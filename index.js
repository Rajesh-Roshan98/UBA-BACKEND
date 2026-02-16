require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const dbConnect = require("./config/dbConnect");
const authRouter = require("./routes/authroutes");
const ubaRoutes = require("./routes/ubaRoutes");
const adminRoutes = require("./routes/adminRoutes");
const mlHealthCheck = require("./utils/mlHealthCheck");

const app = express();

/* ---------- CORS (AuthContext Support) ---------- */
app.use(
  cors({
    origin: [
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"], // 🔑 REQUIRED
    credentials: true,
  })
);

/* ---------- BODY PARSER ---------- */
app.use(express.json());

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
app.use("/api/v1", authRouter);   // 🔑 AuthContext uses this
app.use("/api/uba", ubaRoutes);
app.use("/api/admin", adminRoutes);

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
      app.listen(PORT, () =>
        console.log(`🚀 Server running on port ${PORT}`)
      );
    })
    .catch((err) => {
      console.error("❌ DB Connection Error", err);
    });
}

module.exports = app;
