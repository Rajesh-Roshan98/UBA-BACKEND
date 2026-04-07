const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true, // 🔥 ADDED: Fast lookup to see all permissions for a specific user
  },
  resource: {
    type: String,
    required: true,
    index: true, // 🔥 ADDED: Fast lookup to see everyone who has access to a specific resource
  },
  accessType: { 
    type: String,
    enum: ["Read Only", "Read/Write", "Admin"],
    default: "Read Only",
  },
  justification: {
    type: String,
  },
  grantedBy: {
    type: String, // Or ObjectId if you track admin IDs
    required: true,
  },
  expiryDate: {
    type: Date,
    required: true,
    index: true, // 🔥 ADDED: Extremely fast queries for finding/cleaning up expired permissions
  },
  status: {
    type: String,
    enum: ["active", "expired", "revoked", "pending"],
    default: "active",
    index: true, // 🔥 ADDED: Fast counting for the "Active" and "Pending" dashboard stats
  },
}, { timestamps: true });

// 🔥 ADDED: Crucial for sorting the access control table by newest first
permissionSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Permission", permissionSchema);