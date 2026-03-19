const generateOtpEmail = (otpValue) => {
  const currentYear = new Date().getFullYear();
  
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Verification</title>
  </head>
  <body style="margin:0; padding:0; background-color:#0f172a; font-family:'Segoe UI', Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
    
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#0f172a; padding: 20px;">
      <tr>
        <td align="center"> 
          
          <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:450px; background-color:#1e293b; border-radius:16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); overflow:hidden; border: 1px solid #334155;">
            
            <tr>
              <td style="height:6px; background: linear-gradient(90deg, #0ea5e9 0%, #6366f1 100%);"></td>
            </tr>

            <tr>
              <td style="padding: 40px 30px; text-align:center;">
                
                <div style="display:inline-block; padding:12px; background-color:rgba(56, 189, 248, 0.1); border-radius:50%; margin-bottom:20px;">
                  <div style="font-size: 24px;">🛡️</div>
                </div>

                <h1 style="color:#f1f5f9; margin:0 0 10px 0; font-size:20px; font-weight:700; letter-spacing:0.5px;">
                  Verify Your Login
                </h1>
                
                <p style="color:#94a3b8; font-size:14px; margin:0 0 25px 0; line-height:1.6;">
                  Please verify your identity to continue.
                </p>

                <div style="background-color:#0f172a; border:1px solid #334155; border-radius:8px; padding:10px 15px; margin-bottom:25px; text-align:center;">
                  <p style="color:#64748b; font-size:10px; text-transform:uppercase; margin:0 0 4px 0; font-weight:700; letter-spacing:1px;">System</p>
                  <p style="color:#e2e8f0; font-size:11px; margin:0; font-weight:500; line-height:1.4;">
                    Cloud Data Exfiltration Prevention & UBA
                  </p>
                </div>

                <div style="margin-bottom: 25px;">
                  <div style="
                    background-color: #0f172a;
                    border: 1px solid #38bdf8;
                    border-radius: 12px;
                    padding: 15px;
                    display: block;
                  ">
                    <span style="
                      font-family: 'Courier New', monospace;
                      font-size: 32px;
                      font-weight: 700;
                      color: #38bdf8;
                      letter-spacing: 8px;
                      display: block;
                      text-align: center;
                    ">
                      ${otpValue}
                    </span>
                  </div>
                </div>

                <p style="color:#f87171; font-size:12px; font-weight:500; margin:0;">
                  ⏰ This code expires in 5 minutes
                </p>

              </td>
            </tr>

            <tr>
              <td style="background-color:#1e293b; border-top:1px solid #334155; padding: 20px; text-align:center;">
                <p style="color:#64748b; font-size:11px; margin:0; line-height:1.5;">
                  If you didn't request this code, you can safely ignore this email.
                </p>
                <p style="color:#475569; font-size:11px; margin-top:10px;">
                  &copy; ${currentYear} UBA Security Systems
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
};

module.exports = generateOtpEmail;