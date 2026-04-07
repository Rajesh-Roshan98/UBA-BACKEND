const generateOtpEmail = (otpValue) => {
  const currentYear = new Date().getFullYear();
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        background-color: #f3f4f6;
        margin: 0; 
        padding: 40px 20px;
        color: #1f2937;
      }

      .container {
        max-width: 600px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 8px 20px rgba(0,0,0,0.04);
      }

      .header {
        padding: 36px 40px 20px 40px;
      }

      .header h1 {
        margin: 0;
        font-size: 22px;
        font-weight: 600;
        color: #111827;
      }

      .subtitle {
        margin-top: 6px;
        font-size: 14px;
        color: #6b7280;
      }

      .content {
        padding: 0 40px 36px 40px;
      }

      .content p {
        font-size: 15px;
        line-height: 1.7;
        margin: 0 0 18px 0;
        color: #374151;
      }

      .otp-box {
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 24px;
        margin: 28px 0;
        text-align: center;
      }

      .otp-code {
        font-family: 'Courier New', Courier, monospace;
        font-size: 36px;
        font-weight: 700;
        color: #2563eb;
        letter-spacing: 8px;
        margin: 0;
      }

      .expiration {
        text-align: center;
        font-size: 13px;
        color: #ef4444;
        font-weight: 500;
        margin-top: -10px;
        margin-bottom: 20px;
      }

      .footer {
        padding: 20px 40px;
        background-color: #f9fafb;
        border-top: 1px solid #e5e7eb;
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
      }

      .footer p {
        margin: 0 0 6px 0;
        font-size: 12px;
        color: #6b7280;
        line-height: 1.5;
      }

      @media only screen and (max-width: 600px) {
        body {
          padding: 20px 12px;
        }
        .header,
        .content,
        .footer {
          padding-left: 24px;
          padding-right: 24px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">

      <div class="header">
        <h1>Verify Your Account</h1>
        <div class="subtitle">Cloud Data Exfiltration Prevention & UBA</div>
      </div>

      <div class="content">
        <p>Hello,</p>
        <p>Please use the verification code below to verify your account.</p>

        <div class="otp-box">
          <div class="otp-code">${otpValue}</div>
        </div>

        <div class="expiration">
          ⏰ This code expires in 5 minutes
        </div>

      </div>

      <div class="footer">
        <p>If you didn't request this code, you can safely ignore this email.</p>
        <p>&copy; ${currentYear} UBA Security Systems. All rights reserved.</p>
      </div>

    </div>
  </body>
  </html>
  `;
};

module.exports = generateOtpEmail;