const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs"); 
const nodemailer = require("nodemailer");

// 🔥 UPDATED: Now importing the Admin model instead of User
const Admin = require("../models/adminModel");

// 🔧 Load environment variables from the parent backend folder
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const createAdmins = async () => {
  try {
    // 1. Connect to the database
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is missing in .env file");
    }
    
    await mongoose.connect(process.env.DB_URL);
    console.log("📦 Connected to MongoDB...");

    // 2. Read the JSON seed file
    const seedFilePath = path.join(__dirname, "admin.json");
    
    if (!fs.existsSync(seedFilePath)) {
      throw new Error("admin.json file not found! Please create it in the scripts folder.");
    }

    const rawData = fs.readFileSync(seedFilePath);
    const adminsToCreate = JSON.parse(rawData);

    // 3. Set up the email transporter once
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 4. Loop through the JSON array and create each admin
    for (const adminData of adminsToCreate) {
      // 🔥 UPDATED: Checking existing record in Admin model
      const existingAdmin = await Admin.findOne({ email: adminData.email });

      if (existingAdmin) {
        console.log(`✅ Admin account already exists with email: ${adminData.email}. Skipping...`);
        continue; 
      }

      // Hash the password securely
      const hashedPassword = await bcrypt.hash(adminData.password, 10);

      // 🔥 UPDATED: Create the Admin using the Admin model
      await Admin.create({
        firstName: adminData.firstName || "System",
        middleName: adminData.middleName || "",
        lastName: adminData.lastName || "Admin",
        email: adminData.email,
        password: hashedPassword,
        role: "admin",
        isEmailVerified: true, 
      });

      console.log(`🚀 Admin ${adminData.email} successfully created in the database!`);

      // 5. Send the credentials via Email
      console.log(`📧 Dispatching credentials to ${adminData.email}...`);

      const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #4f46e5;">UBA System Admin Portal</h2>
          <p>Hello ${adminData.firstName},</p>
          <p>An administrative account has been provisioned for you on the User Behavioral Analytics platform.</p>
          
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Your Login Credentials:</strong></p>
            <p style="margin: 0 0 5px 0;"><strong>Email:</strong> ${adminData.email}</p>
            <p style="margin: 0;"><strong>Password:</strong> ${adminData.password}</p>
          </div>

          <p style="color: #dc2626; font-weight: bold; padding-left: 10px; border-left: 4px solid #dc2626;">
            ⚠️ IMPORTANT: Please log in immediately and navigate to your profile settings to change this temporary password.
          </p>
          
          <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
            Securely yours,<br/>
            The UBA System
          </p>
        </div>
      `;

      await transporter.sendMail({
        from: `"UBA System Admin" <${process.env.EMAIL_USER}>`,
        to: adminData.email,
        subject: "Action Required: Your Admin Credentials",
        html: emailTemplate,
      });

      console.log(`✅ Secure email sent to ${adminData.email} successfully.\n`);
    }

  } catch (error) {
    console.error("❌ Error running admin script:", error.message);
  } finally {
    // 6. Close the database connection and exit
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log("🔌 Disconnected from MongoDB.");
    }
    process.exit(0);
  }
};

// Execute the function
createAdmins();