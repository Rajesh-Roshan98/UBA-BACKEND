const { Server } = require("socket.io");
const jwt = require("jsonwebtoken"); // 🔥 NEW: Required for secure socket registration

let io;
// Upgraded to a Map and Set to support multi-device logins (Phone + Laptop simultaneously)
const userSockets = new Map(); // userId => Set of socketIds

const initSocket = (server) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(url => url.trim().replace(/\/$/, '')) 
    : ["http://localhost:5173", "https://cloud-uba.vercel.app"]; // 🔥 Added your Vercel URL as a safe fallback

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    },
    // 🔥 UPDATE 1: Enable Backend State Recovery to match the frontend config
    connectionStateRecovery: {
      maxDisconnectionDuration: 120000, // 2 minutes (matches your Axios timeout)
    },
    // 🔥 UPDATE 2: Tweak ping settings to prevent Render's proxy from dropping idle sockets
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // 🔥 FIX 2 & 3: Industry Standard Handshake Auth & Token Expiry Handling moved to Middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // 🔥 UPDATE 3: Match the ID extraction logic from your AuthContext!
      // This ensures admins or raw Mongo objects aren't accidentally rejected.
      const activeUserId = decoded.userId || decoded.adminId || decoded._id;
      
      if (!activeUserId) return next(new Error("Invalid token payload"));

      socket.userId = activeUserId; // Store securely in the socket instance
      
      next(); // Proceed to connection

    } catch (err) {
      console.error("Socket Auth Error: Invalid or expired token");
      return next(new Error("Unauthorized")); // Triggers 'connect_error' on the frontend
    }
  });

  io.on("connection", (socket) => {
    // We already know the user is authenticated here because of the middleware!
    const userId = socket.userId;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    socket.on("disconnect", () => {
      // 🔥 O(1) Performance Upgrade: Direct lookup instead of looping through all users
      const userId = socket.userId;
      if (!userId) return;

      const sockets = userSockets.get(userId);
      if (!sockets) return;

      sockets.delete(socket.id);

      // If the user closed their last remaining tab/device, delete them from the map entirely
      if (sockets.size === 0) {
        userSockets.delete(userId);
      }
    });
  });

  return io;
};

const getIo = () => {
  if (!io) throw new Error("Socket.io is not initialized!");
  return io;
};

// Clean helper function so you don't have to write messy socket logic in your controllers
const emitToUser = (userId, event, data) => {
  if (!io) return; 

  const sockets = userSockets.get(userId);
  if (!sockets) return; // User is currently offline, do nothing

  // Send the notification to EVERY open tab and device this user has
  sockets.forEach((socketId) => {
    io.to(socketId).emit(event, data);
  });
};

module.exports = { initSocket, getIo, userSockets, emitToUser };