const generateAuthEmail = (type, otp = null) => {
  // Define dynamic properties based on the email type
  const isOtp = type === "OTP";
  const headerBgColor = isOtp ? "#4f46e5" : "#10b981"; // Indigo for OTP, Green for Success
  const title = isOtp ? "Password Reset Request" : "Password Updated Successfully";

  // Dynamic Content Block
  const bodyContent = isOtp 
    ? `
      <p style="margin: 0 0 16px; font-size: 15px; color: #334155;">Hello,</p>
      <p style="margin: 0 0 24px; font-size: 15px; color: #475569; line-height: 1.6;">
        We received a request to reset the password for your account. Please use the verification code below to complete the process:
      </p>
       
      <div style="text-align: center; margin: 32px 0; padding: 24px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <p style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 700; color: #4f46e5; letter-spacing: 12px; margin: 0; padding-left: 12px;">${otp}</p>
      </div>
      
      <p style="margin: 0 0 32px; font-size: 14px; color: #475569; text-align: center;">
        This code will expire in <strong>5 minutes</strong>.
      </p>
      
      <div style="background-color: #f8fafc; border-left: 4px solid #cbd5e1; padding: 16px 20px; border-radius: 0 6px 6px 0; margin-top: 10px;">
        <h4 style="margin: 0 0 8px; font-size: 14px; color: #1e293b;">Didn't request this?</h4>
        <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
          If you did not initiate this password reset, you can safely ignore this email. Your password will not be changed unless you enter the verification code above.
        </p>
      </div>
    ` 
    : `
      <div style="text-align: center; margin: 10px 0 30px;">
        <div style="display: inline-block; background-color: #d1fae5; padding: 16px; border-radius: 50%;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
      </div>
      
      <p style="margin: 0 0 16px; font-size: 15px; color: #334155;">Hello,</p>
      <p style="margin: 0 0 16px; font-size: 15px; color: #475569; line-height: 1.6;">
        This email is to confirm that the password for your account has been successfully changed.
      </p>
      <p style="margin: 0 0 32px; font-size: 15px; color: #475569; line-height: 1.6;">
        You can now use your new password to log in to your account dashboard.
      </p>
      
      <div style="background-color: #fff1f2; border-left: 4px solid #e11d48; padding: 16px 20px; border-radius: 0 6px 6px 0; margin-top: 10px;">
        <p style="margin: 0; font-size: 13px; color: #be123c; line-height: 1.5;">
          <strong>Security Alert:</strong> If you did not make this change, please contact our support team immediately to secure your account.
        </p>
      </div>
    `;

  // The base HTML shell
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} | Cloud-UBA</title>
      <style>
        /* Inline CSS for maximum email client compatibility */
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
          background-color: ${headerBgColor}; 
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
          color: rgba(255, 255, 255, 0.9); 
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
          <div class="brand-subtitle">Account Management</div>
        </div>
        
        <div class="content">
          <div class="content-header">
            <h1>${title}</h1>
          </div>
          ${bodyContent}
        </div>
        
        <div class="footer">
          <p>This is an automated message from the Cloud-UBA System.</p>
          <p>&copy; ${new Date().getFullYear()} Cloud-UBA. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = generateAuthEmail;