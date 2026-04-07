const User = require("../models/userModel");
const Admin = require("../models/adminModel"); // 🔥 NEW: Imported the Admin model
const fs = require('fs');
const path = require('path');
const { logActivity } = require("../utils/logger");

/* ================= GET PROFILE ================= */
exports.getProfile = async (req, res) => {
  try {
    // ==========================================
    // 🔥 NEW: INJECTED ADMIN GET PROFILE LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") { 
      let admin = await Admin.findById(req.user.userId).select("-password").lean();
      
      if (!admin) {
        return res.status(404).json({ success: false, message: "Admin not found" });
      }

      if (!admin.avatar || admin.avatar === 'null' || admin.avatar === 'undefined' || admin.avatar.trim() === '') {
        admin.avatar = "";
      }

      if (admin.location === undefined || admin.location === null) {
        admin.location = "";
      }

      if (admin.name && (!admin.firstName || !admin.lastName)) {
        const nameParts = admin.name.trim().split(/\s+/);
        admin.firstName = nameParts[0] || "A";
        admin.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "A";
      } else if (!admin.firstName) {
        admin.firstName = "A";
        admin.lastName = "A";
      }

      return res.status(200).json({ success: true, profile: admin });
    }
    // ==========================================
    // END ADMIN LOGIC INJECTION 
    // ==========================================

    let user = await User.findById(req.user.userId).select("-password").lean();
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Sanitize avatar string for frontend initials trigger
    if (!user.avatar || user.avatar === 'null' || user.avatar === 'undefined' || user.avatar.trim() === '') {
      user.avatar = "";
    }

    // ✅ FIX: Ensure location is strictly preserved (captures "unknown" vs "")
    if (user.location === undefined || user.location === null) {
      user.location = "";
    }

    // Extract names if only a single 'name' field exists in the document
    if (user.name && (!user.firstName || !user.lastName)) {
      const nameParts = user.name.trim().split(/\s+/);
      user.firstName = nameParts[0] || "U";
      user.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "U";
    } else if (!user.firstName) {
      user.firstName = "U";
      user.lastName = "U";
    }

    return res.status(200).json({ 
      success: true, 
      profile: user 
    });
  } catch (error) {
    console.error("GET PROFILE ERROR:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to load profile data" 
    });
  }
};

/* ================= UPDATE PROFILE ================= */
exports.updateProfile = async (req, res) => {
  try {
    const { 
      name, 
      phone, 
      location, 
      bio, 
      jobTitle, 
      company, 
      website, 
      skills 
    } = req.body;

    const userId = req.user.userId;

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN UPDATE PROFILE LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      let updatedAdmin = await Admin.findByIdAndUpdate(
        userId,
        { $set: { name, phone, location, bio, jobTitle, company, website, skills } },
        { new: true, runValidators: true }
      ).select("-password").lean();

      if (!updatedAdmin) {
        return res.status(404).json({ success: false, message: "Admin not found" });
      }

      if (!updatedAdmin.avatar || updatedAdmin.avatar === 'null' || updatedAdmin.avatar === 'undefined' || updatedAdmin.avatar.trim() === '') {
        updatedAdmin.avatar = "";
      }
      if (updatedAdmin.location === undefined || updatedAdmin.location === null) {
        updatedAdmin.location = "";
      }
      if (updatedAdmin.name && (!updatedAdmin.firstName || !updatedAdmin.lastName)) {
        const nameParts = updatedAdmin.name.trim().split(/\s+/);
        updatedAdmin.firstName = nameParts[0] || "A";
        updatedAdmin.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "A";
      } else if (!updatedAdmin.firstName) {
        updatedAdmin.firstName = "A";
        updatedAdmin.lastName = "A";
      }

      await logActivity({
        adminId: userId,
        role: "admin", // Ensures it triggers the AdminLog block in logger.js
        action: "profile_update",
        category: "profile",
        details: "Admin updated their profile information",
        req: req
      });

      return res.status(200).json({ success: true, message: "Profile updated successfully", profile: updatedAdmin });
    }
    // ==========================================
    // END ADMIN LOGIC INJECTION 
    // ==========================================

    let updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          name, 
          phone,
          location,
          bio,
          jobTitle,
          company,
          website,
          skills
        }
      },
      { new: true, runValidators: true }
    ).select("-password").lean();

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Sanitize profile data before returning
    if (!updatedUser.avatar || updatedUser.avatar === 'null' || updatedUser.avatar === 'undefined' || updatedUser.avatar.trim() === '') {
      updatedUser.avatar = "";
    }

    // ✅ FIX: Ensure updated location is strictly preserved
    if (updatedUser.location === undefined || updatedUser.location === null) {
      updatedUser.location = "";
    }

    if (updatedUser.name && (!updatedUser.firstName || !updatedUser.lastName)) {
      const nameParts = updatedUser.name.trim().split(/\s+/);
      updatedUser.firstName = nameParts[0] || "U";
      updatedUser.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : "U";
    } else if (!updatedUser.firstName) {
      updatedUser.firstName = "U";
      updatedUser.lastName = "U";
    }

    await logActivity({
      userId: req.user.userId,
      action: "profile_update",
      category: "profile",
      details: "User updated their public profile information",
      req: req
    });

    return res.status(200).json({ 
      success: true, 
      message: "Profile updated successfully",
      profile: updatedUser 
    });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update profile" 
    });
  }
};

/* ================= UPLOAD AVATAR ================= */
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a file' });
    }

    if (req.file.size > 3 * 1024 * 1024) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ success: false, message: 'Image size must be less than 3MB' });
    }

    const avatarUrlPath = `/${req.file.path.replace(/\\/g, '/')}`; 

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN UPLOAD LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      try {
        // 🔥 OPTIMIZED: Added .select("avatar") so we only pull the string we need to delete the old file
        const currentAdmin = await Admin.findById(req.user.userId).select("avatar").lean();
        if (currentAdmin && currentAdmin.avatar && currentAdmin.avatar.trim() !== "") {
          const oldImagePath = path.join(__dirname, '..', currentAdmin.avatar);
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        }
      } catch (fsError) {
        console.error("Failed to delete old admin avatar file:", fsError);
      }

      // ✅ OPTIMIZED: Added .lean()
      const updatedAdmin = await Admin.findByIdAndUpdate(
        req.user.userId,
        { avatar: avatarUrlPath },
        { new: true }
      ).select('-password').lean();

      if (!updatedAdmin) {
        return res.status(404).json({ success: false, message: 'Admin not found during update' });
      }

      await logActivity({
        adminId: req.user.userId,
        role: "admin", // Ensures it triggers the AdminLog block in logger.js
        action: "avatar_update",
        category: "profile",
        details: "Admin updated their profile picture",
        req: req
      });

      return res.status(200).json({ 
        success: true,
        message: 'Avatar updated successfully', 
        avatarUrl: updatedAdmin.avatar
      });
    }
    // ==========================================
    // END ADMIN LOGIC INJECTION 
    // ==========================================

    try {
      // 🔥 OPTIMIZED: Added .select("avatar") so we only pull the string we need to delete the old file
      const currentUser = await User.findById(req.user.userId).select("avatar").lean();
      if (currentUser && currentUser.avatar && currentUser.avatar.trim() !== "") {
        const oldImagePath = path.join(__dirname, '..', currentUser.avatar);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
    } catch (fsError) {
      console.error("Failed to delete old avatar file:", fsError);
    }

    // ✅ OPTIMIZED: Added .lean()
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { avatar: avatarUrlPath },
      { new: true }
    ).select('-password').lean();

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found during update' });
    }

    await logActivity({
      userId: req.user.userId,
      action: "avatar_update",
      category: "profile",
      details: "User updated their profile picture",
      req: req
    });

    res.status(200).json({ 
      success: true,
      message: 'Avatar updated successfully', 
      avatarUrl: updatedUser.avatar
    });
  } catch (error) {
    console.error("AVATAR UPLOAD ERROR:", error);
    res.status(500).json({ success: false, message: 'Server error during upload', error: error.message });
  }
};