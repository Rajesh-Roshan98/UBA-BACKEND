const generateAuthEmail = (type, otp = null) => {
  // Define dynamic properties based on the email type
  const isOtp = type === "OTP";
  const headerBgColor = isOtp ? "#4f46e5" : "#10b981"; // Indigo for OTP, Green for Success
  const title = isOtp ? "Password Reset Request" : "Password Updated";

  // Dynamic Content Block
  const bodyContent = isOtp 
    ? `
      <p>Hello,</p>
      <p>We received a request to reset the password for your account. Please use the verification code below to complete the process:</p>
      
      <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f1f5f9; border-radius: 8px;">
        <p style="font-size: 32px; font-weight: bold; color: #4f46e5; letter-spacing: 8px; margin: 0;">${otp}</p>
      </div>
      
      <p>This code will expire in <strong>5 minutes</strong>.</p>
      
      <div style="font-size: 13px; color: #64748b; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        <p><strong>Didn't request this?</strong> If you did not initiate this password reset, you can safely ignore this email. Your password will not be changed unless you enter the code above.</p>
      </div>
    ` 
    : `
      <div style="text-align: center; margin: 20px 0;">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </div>
      
      <p>Hello,</p>
      <p>This email is to confirm that the password for your account has been successfully changed.</p>
      <p>You can now use your new password to log in to your dashboard.</p>
      
      <div style="background-color: #fff1f2; border: 1px solid #fecdd3; padding: 15px; border-radius: 8px; color: #e11d48; font-size: 14px; margin-top: 30px;">
        <p style="margin: 0;"><strong>Security Alert:</strong> If you did not make this change, please contact our support team immediately to secure your account.</p>
      </div>
    `;

  // The base HTML shell
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background-color: ${headerBgColor}; padding: 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 40px 30px; color: #334155; line-height: 1.6; }
        .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${title}</h1>
        </div>
        <div class="content">
          ${bodyContent}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Your Company Name. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
module.exports =generateAuthEmail;