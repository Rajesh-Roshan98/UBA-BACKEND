const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First Name is Required"],
      trim: true,
    },
    middleName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last Name is Required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is Required"],
      trim: true,
      unique: true,
    },
    password: {
      type: String,
      select: false,
    },

    // ✅ THIS FIELD WAS MISSING (CRITICAL)
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
