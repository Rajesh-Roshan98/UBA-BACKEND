const generateOtpEmail = (otpValue) => {
  const currentYear = new Date().getFullYear();
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Account | Cloud-UBA</title>
    <style>
      /* Inline CSS for maximum email client compatibility */
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #f4f4f5;
        margin: 0; 
        padding: 40px 20px;
        color: #334155;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        overflow: hidden;
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
      .header {
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid #f1f5f9;
      }
      .header h1 {
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
      .otp-box {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 24px;
        margin: 32px 0;
        text-align: center;
      }
      .otp-code {
        font-family: 'Courier New', Courier, monospace;
        font-size: 38px;
        font-weight: 700;
        color: #4f46e5;
        letter-spacing: 12px;
        margin: 0;
        padding-left: 12px; /* Visual centering for letter-spacing */
      }
      .expiration {
        text-align: center;
        font-size: 14px;
        color: #475569;
        margin-top: -16px;
        margin-bottom: 32px;
      }
      .footer {
        background-color: #f8fafc;
        padding: 20px 30px;
        font-size: 12px;
        color: #64748b;
        text-align: center;
        border-top: 1px solid #e2e8f0;
      }
      .footer p {
        margin: 4px 0;
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
        <div class="brand-subtitle">Identity Verification</div>
      </div>

      <div class="content">
        <div class="header">
          <h1>Verify Your Account</h1>
        </div>

        <p>Hello,</p>
        <p>Please use the verification code below to verify your account.</p>

        <div class="otp-box">
          <div class="otp-code">${otpValue}</div>
        </div>

        <div class="expiration">
          This code will expire in <strong>5 minutes</strong>.
        </div>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #cbd5e1; padding: 16px 20px; border-radius: 0 6px 6px 0; margin-top: 10px;">
          <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
            If you did not request this verification code, you can safely ignore this email. Your account remains secure.
          </p>
        </div>

      </div>

      <div class="footer">
        <p>This is an automated message from the Cloud-UBA Security System.</p>
        <p>&copy; ${currentYear} Cloud-UBA. All rights reserved.</p>
      </div>

    </div>
  </body>
  </html>
  `;
};

module.exports = generateOtpEmail;