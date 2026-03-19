const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  resource: {
    type: String,
    required: true,
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
  },
  status: {
    type: String,
    enum: ["active", "expired", "revoked", "pending"],
    default: "active",
  },
}, { timestamps: true });

module.exports = mongoose.model("Permission", permissionSchema);