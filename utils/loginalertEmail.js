const failedLoginEmail = (alertId) => {
  const baseUrl = (process.env.FRONTEND_URL).replace(/\/$/, "");
  const queryParams = `?alertId=${alertId}`;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Alert | Cloud-UBA</title>
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
      .subtitle {
        margin-top: 6px;
        font-size: 14px;
        color: #64748b;
      }
      .content p {
        font-size: 15px;
        line-height: 1.6;
        margin: 0 0 16px 0;
        color: #334155;
      }
      .highlight-box {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 16px;
        margin: 20px 0;
        font-size: 14px;
        color: #475569;
        line-height: 1.6;
      }
      .button-wrapper {
        margin-top: 28px;
        margin-bottom: 8px;
      }
      .btn {
        display: inline-block;
        padding: 12px 28px;
        background-color: #4f46e5;
        color: #ffffff !important;
        text-decoration: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
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

      <div class="brand-header">
        <div class="brand-logo">Cloud-UBA</div>
        <div class="brand-subtitle">Security Alert</div>
      </div>

      <div class="content">
        <div class="header">
          <h1>We noticed something unusual</h1>
          <div class="subtitle">Multiple failed login attempts were detected</div>
        </div>

        <p>Hello,</p>

        <p>We recently detected several failed attempts to sign in to your account using an incorrect password.</p>

        <div class="highlight-box">
          If this was you, there’s nothing to worry about.<br>
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
        <p>This is an automated message from the Cloud-UBA Monitoring System.</p>
        <p>If you did not request this notification, you can safely ignore this email after reviewing the activity.</p>
        <p>&copy; ${new Date().getFullYear()} Cloud-UBA. All rights reserved.</p>
      </div>

    </div>
  </body>
  </html>
  `;
};

module.exports = failedLoginEmail;