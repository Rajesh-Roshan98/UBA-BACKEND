const multer = require('multer');
const path = require('path');
const fs = require('fs');

/* =========================================================
   1. DIRECTORY SETUP
========================================================= */

// Ensure the avatar upload directory exists
const avatarUploadDir = 'uploads/avatars';
if (!fs.existsSync(avatarUploadDir)) {
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}

// Ensure the temp directory exists when the server starts
const tempDir = path.join(__dirname, '../temp_uploads');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

/* =========================================================
   2. AVATAR UPLOAD CONFIGURATION (Images Only, 1MB Limit)
========================================================= */

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, avatarUploadDir); 
  },
  filename: function (req, file, cb) {
    // Creates a unique filename: userId-timestamp.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `user-${req.user.userId}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Filter for images only
const avatarFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and GIF are allowed.'), false);
  }
};

// Initialize Avatar Multer
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 1024 * 1024 // 1MB limit (matches your UI text)
  },
  fileFilter: avatarFileFilter
});

/* =========================================================
   3. TEMP FILE UPLOAD CONFIGURATION (Unrestricted, All Files)
========================================================= */

// Configure Disk Storage (CRITICAL FOR 100GB FILES)
const tempStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Stream the file directly to the temp folder
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // Add a timestamp to the filename to prevent overwriting if two files have the same name
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

// Initialize Temp File Multer
const uploadTempFile = multer({ 
    storage: tempStorage,
    // Note: We are deliberately NOT setting a 'limits: { fileSize: ... }' here 
    // so that it allows unrestricted file sizes (up to your OS/Disk limits).
});

/* =========================================================
   4. EXPORTS
========================================================= */

module.exports = {
    uploadAvatar,
    uploadTempFile
};