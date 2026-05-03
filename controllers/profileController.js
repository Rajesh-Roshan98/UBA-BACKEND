const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const { logActivity } = require("../utils/logger");
const cloudinary = require('cloudinary').v2; // 🔥 NEW: Imported Cloudinary for image deletion

/* ================= HELPER FUNCTIONS ================= */
const sanitizeProfile = (data, defaultChar) => {
  if (!data.avatar || data.avatar === 'null' || data.avatar === 'undefined' || data.avatar.trim() === '') {
    data.avatar = "";
  }

  if (data.location === undefined || data.location === null) {
    data.location = "";
  }

  if (data.name && (!data.firstName || !data.lastName)) {
    const parts = data.name.trim().split(/\s+/);
    data.firstName = parts[0] || defaultChar;
    data.lastName = parts.length > 1 ? parts.slice(1).join(' ') : defaultChar;
  } else if (!data.firstName) {
    data.firstName = defaultChar;
    data.lastName = defaultChar;
  }

  return data;
};

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

      admin = sanitizeProfile(admin, "A"); // ✅ FIX 4: Reusable cleaner helper

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

    user = sanitizeProfile(user, "U"); // ✅ FIX 4: Reusable cleaner helper

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

    // ✅ FIX 3: Dynamic update fields to prevent overwriting with undefined
    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (phone !== undefined) updateFields.phone = phone;
    if (location !== undefined) updateFields.location = location;
    if (bio !== undefined) updateFields.bio = bio;
    if (jobTitle !== undefined) updateFields.jobTitle = jobTitle;
    if (company !== undefined) updateFields.company = company;
    if (website !== undefined) updateFields.website = website;
    if (skills !== undefined) updateFields.skills = skills;

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN UPDATE PROFILE LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      let updatedAdmin = await Admin.findByIdAndUpdate(
        userId,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select("-password").lean();

      if (!updatedAdmin) {
        return res.status(404).json({ success: false, message: "Admin not found" });
      }

      updatedAdmin = sanitizeProfile(updatedAdmin, "A"); // ✅ FIX 4: Reusable cleaner helper

      await logActivity({
        adminId: userId,
        email: updatedAdmin.email,
        role: "admin", 
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
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select("-password").lean();

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    updatedUser = sanitizeProfile(updatedUser, "U"); // ✅ FIX 4: Reusable cleaner helper

    await logActivity({
      userId: req.user.userId,
      email: updatedUser.email,
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

    // ✅ FIX 1: Removed redundant size validation since Multer handles it natively

    const avatarUrlPath = req.file.path; 

    // ==========================================
    // 🔥 NEW: INJECTED ADMIN UPLOAD LOGIC
    // ==========================================
    if (req.user && req.user.role === "admin") {
      
      // ✅ FIX 2: Delete old image from Cloudinary
      try {
        const oldAdmin = await Admin.findById(req.user.userId).select("avatar").lean();
        if (oldAdmin?.avatar) {
          const publicId = oldAdmin.avatar.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(`uba_avatars/${publicId}`);
        }
      } catch (cloudErr) {
        console.error("Cloudinary deletion error:", cloudErr);
      }

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
        email: updatedAdmin.email,
        role: "admin", 
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

    // ✅ FIX 2: Delete old image from Cloudinary
    try {
      const oldUser = await User.findById(req.user.userId).select("avatar").lean();
      if (oldUser?.avatar) {
        const publicId = oldUser.avatar.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`uba_avatars/${publicId}`);
      }
    } catch (cloudErr) {
      console.error("Cloudinary deletion error:", cloudErr);
    }

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
      email: updatedUser.email,
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