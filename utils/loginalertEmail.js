const failedLoginEmail = (alertId) => {
  const baseUrl = (process.env.FRONTEND_URL).replace(/\/$/, "");
  const queryParams = `?alertId=${alertId}`;

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

      .highlight-box {
        background-color: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 16px;
        margin: 20px 0;
        font-size: 14px;
        color: #4b5563;
      }

      .button-wrapper {
        margin-top: 28px;
      }

      .btn {
        display: inline-block;
        padding: 12px 28px;
        background-color: #2563eb;
        color: #ffffff !important;
        text-decoration: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
      }

      .footer {
        padding: 20px 40px;
        background-color: #f9fafb;
        border-top: 1px solid #e5e7eb;
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
        .btn {
          display: block;
          width: 100%;
          text-align: center;
          box-sizing: border-box;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">

      <div class="header">
        <h1>We noticed something unusual</h1>
        <div class="subtitle">Multiple failed login attempts were detected</div>
      </div>

      <div class="content">

        <p>Hello,</p>

        <p>We recently detected several failed attempts to sign in to your account using an incorrect password.</p>

        <div class="highlight-box">
          If this was you, there’s nothing to worry about.  
          If it wasn’t, we recommend reviewing the activity to keep your account secure.
        </div>

        <p>Your security is important to us. Please take a moment to confirm whether this activity was legitimate.</p>

        <div class="button-wrapper">
          <a href="${baseUrl}/check-activity${queryParams}" class="btn">
            Review Activity
          </a>
        </div>

      </div>

      <div class="footer">
        <p>This is an automated message from the UBA Monitoring System.</p>
        <p>If you did not request this notification, you can safely ignore this email after reviewing the activity.</p>
        <p>&copy; ${new Date().getFullYear()} Climacast. All rights reserved.</p>
      </div>

    </div>
  </body>
  </html>
  `;
};

module.exports = failedLoginEmail;