const ContactEmail = (name, email, message) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Contact Message</title>
  <style>
    /* Inline CSS for maximum email client compatibility */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #334155;
      margin: 0;
      padding: 40px 20px;
    } 
    .container {
      max-width: 500px;
      margin: 0 auto;
      background-color: #ffffff;
      padding: 30px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      margin-bottom: 24px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 16px;
      font-size: 20px;
      font-weight: 600;
      color: #0f172a;
    }
    .field {
      margin-bottom: 20px;
    }
    .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .value {
      font-size: 15px;
      line-height: 1.6;
      color: #334155;
    }
    .message-box {
      background-color: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      margin-top: 8px;
      white-space: pre-wrap; /* Keeps the user's paragraph breaks */
    }
    .link {
      color: #4f46e5;
      text-decoration: none;
    }
    .footer {
      margin-top: 32px;
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">New Contact Submission</div>
    
    <div class="field">
      <div class="label">From</div>
      <div class="value"><strong>${name}</strong></div>
    </div>

    <div class="field">
      <div class="label">Email Address</div>
      <div class="value"><a href="mailto:${email}" class="link">${email}</a></div>
    </div>

    <div class="field">
      <div class="label">Message</div>
      <div class="value message-box">${message}</div>
    </div>

    <div class="footer">
      This is an automated notification from your website's contact form.
    </div>
  </div>
</body>
</html>
`;

module.exports = ContactEmail;