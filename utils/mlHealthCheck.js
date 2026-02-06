const { exec } = require("child_process");
const path = require("path");

const mlHealthCheck = () => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "../ml/health_check.py");
    const cmd = `python "${scriptPath}"`;

    console.log("🚀 Running ML Health Check...");

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ ML Health Check Failed");
        console.error(stderr || error.message);
        return reject(error);
      }

      const output = stdout.trim();

      if (output === "ML_OK") {
        console.log("✅ ML Health Check Passed");
        resolve(true);
      } else {
        console.error("❌ ML Health Check Failed: Invalid Output");
        console.error("Output:", output);
        reject(new Error("ML health check output invalid"));
      }
    });
  });
};

module.exports = mlHealthCheck;
