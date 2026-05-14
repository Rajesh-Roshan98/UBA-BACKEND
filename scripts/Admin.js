const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs"); 
const nodemailer = require("nodemailer");

// 🔥 UPDATED: Now importing the Admin model instead of User
const Admin = require("../models/adminModel");

// 🔧 Load environment variables from the parent backend folder
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// 🔥 NEW: Helper to generate 10-char alphanumeric ID
const generateAdminId = (firstName) => {
  const cleanName = (firstName || "Admin").replace(/[^a-zA-Z]/g, '').toUpperCase().substring(0, 5);
  const numLength = 10 - cleanName.length;
  const randomNums = Math.floor(Math.random() * Math.pow(10, numLength)).toString().padStart(numLength, '0');
  return cleanName + randomNums;
};

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
      
      // 🔥 NEW: Generate the 10-character adminId
      const adminFirstName = adminData.firstName || "System";
      const generatedAdminId = generateAdminId(adminFirstName);

      // 🔥 UPDATED: Create the Admin using the Admin model with adminId included
      await Admin.create({
        adminId: generatedAdminId, // <-- ADDED THIS LINE
        firstName: adminFirstName,
        middleName: adminData.middleName || "",
        lastName: adminData.lastName || "Admin",
        email: adminData.email,
        password: hashedPassword,
        role: "admin",
        isEmailVerified: true, 
      });

      console.log(`🚀 Admin ${adminData.email} (ID: ${generatedAdminId}) successfully created in the database!`);

      // 5. Send the credentials via Email
      console.log(`📧 Dispatching credentials to ${adminData.email}...`);

      // 🔥 UI SYNC: Updated to match the Cloud-UBA Enterprise Email Template
      const emailTemplate = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Credentials | Cloud-UBA</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
            background-color: #f4f4f5; 
            color: #334155;
            margin: 0; 
            padding: 40px 20px; 
            -webkit-font-smoothing: antialiased;
          }
          .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background-color: #ffffff; 
            border-radius: 8px; 
            overflow: hidden; 
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.06); 
            border: 1px solid #e2e8f0; 
          }
          .brand-header { 
            background-color: #4f46e5; 
            padding: 24px 30px; 
            text-align: left; 
          }
          .brand-logo { 
            color: #ffffff; 
            font-size: 22px; 
            font-weight: 700; 
            letter-spacing: 0.5px;
            margin: 0; 
          }
          .brand-subtitle { 
            color: #e0e7ff; 
            font-size: 13px; 
            margin-top: 4px; 
            font-weight: 500; 
          }
          .content { 
            padding: 30px; 
          }
          .content-header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #f1f5f9;
          }
          .content-header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: #0f172a;
          }
          .content p {
            font-size: 15px;
            line-height: 1.6;
            margin: 0 0 16px 0;
            color: #334155;
          }
          .credentials-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 20px;
            margin: 24px 0;
          }
          .credentials-box p {
            margin: 0 0 8px 0;
            font-size: 14px;
          }
          .credentials-box p:last-child {
            margin: 0;
          }
          .warning-box {
            background-color: #fff1f2; 
            border-left: 4px solid #e11d48; 
            padding: 16px 20px; 
            border-radius: 0 6px 6px 0; 
            margin-top: 24px;
          }
          .warning-box p {
            margin: 0; 
            font-size: 13px; 
            color: #be123c; 
            line-height: 1.5;
          }
          .footer { 
            background-color: #f8fafc; 
            padding: 20px 30px; 
            text-align: center; 
            border-top: 1px solid #e2e8f0; 
          }
          .footer p {
            margin: 4px 0;
            font-size: 12px; 
            color: #64748b; 
            line-height: 1.5;
          }
          @media only screen and (max-width: 600px) {
            body { padding: 20px 12px; }
            .brand-header, .content, .footer { padding: 24px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="brand-header">
            <div class="brand-logo">Cloud-UBA</div>
            <div class="brand-subtitle">System Administration</div>
          </div>
          
          <div class="content">
            <div class="content-header">
              <h1>Admin Portal Access</h1>
            </div>
            
            <p>Hello ${adminFirstName},</p>
            <p>An administrative account has been provisioned for you on the Cloud-UBA platform.</p>
            
            <div class="credentials-box">
              <p style="margin-bottom: 12px; color: #0f172a; font-weight: 600;">Your Login Credentials:</p>
              <p><strong>Admin ID:</strong> ${generatedAdminId}</p>
              <p><strong>Email:</strong> ${adminData.email}</p>
              <p><strong>Password:</strong> ${adminData.password}</p>
            </div>

            <div class="warning-box">
              <p><strong>Security Notice:</strong> Please log in immediately using your Email or Admin ID and navigate to your profile settings to change this temporary password.</p>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated message from the Cloud-UBA Security System.</p>
            <p>&copy; ${new Date().getFullYear()} Cloud-UBA. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
      `;

      await transporter.sendMail({
        from: `"Cloud-UBA Admin" <${process.env.EMAIL_USER}>`,
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