const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary with your .env credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* =========================================================
   1. AVATAR UPLOAD CONFIGURATION (Images Only, 1MB Limit -> Cloudinary)
========================================================= */

// Swapped diskStorage for CloudinaryStorage
const avatarStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uba_avatars',
    resource_type: 'image', // ✅ FIX 3: Prevents non-image uploads at the Cloudinary API level
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
    transformation: [
      { width: 500, height: 500, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' } // Cloudinary Auto-Optimization
    ],
    // Keeps your exact filename naming convention with safety check
    public_id: (req, file) => {
      const userId = req.user?.userId || 'guest';
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return `user-${userId}-${uniqueSuffix}`;
    }
  }
});

// Strict MIME type validation (Prevents spoofed files)
const avatarFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, and GIF are allowed.'), false);
  }
};

// Initialize Avatar Multer 
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 1024 * 1024, // 1MB limit 
    files: 1               // Prevents multiple files from being uploaded at once
  },
  fileFilter: avatarFileFilter
});

/* =========================================================
   2. EXPORTS
========================================================= */

module.exports = {
    uploadAvatar
};