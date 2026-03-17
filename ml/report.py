import pandas as pd
import os

# ----------------------------
# Configuration
# ----------------------------
PREDICTED_FILE = "data/processed/uba_predicted.csv"
TOP_N = 5  # Number of suspicious users to investigate

# ----------------------------
# Load Data
# ----------------------------
if not os.path.exists(PREDICTED_FILE):
    raise FileNotFoundError(f"❌ {PREDICTED_FILE} not found. Run detection.py first.")

df = pd.read_csv(PREDICTED_FILE)

# Filter for Anomalies only
anomalies = df[df['prediction'] == -1].copy()

if anomalies.empty:
    print("✅ No anomalies detected. Everyone is behaving normally.")
    exit()

# Sort by Anomaly Score (Lower is more anomalous/suspicious)
anomalies = anomalies.sort_values(by='anomaly_score', ascending=True)

print("="*60)
print(f"🚨 UBA THREAT REPORT: TOP {TOP_N} SUSPICIOUS USERS")
print("="*60)

# ----------------------------
# Generate Narrative Report
# ----------------------------
# We define "High" usage as > 2.0 Z-score (standard deviations above peer mean)
# Note: Since we didn't save raw Z-scores in the output CSV to save space, 
# we will infer "High" behavior based on raw values and logic for this report.

for index, row in anomalies.head(TOP_N).iterrows():
    print(f"\n👤 USER: {row['employee_name']} (ID: {row['user_id']})")
    print(f"   ROLE: {row['role']}")
    print(f"   RISK SCORE: {row['anomaly_score']:.4f} (Very High Risk)")
    
    reasons = []
    
    # 1. Check Productivity/Hours
    if row['actions_per_hour'] > 100:
        reasons.append(f"  • 🤖 BOT-LIKE SPEED: {row['actions_per_hour']} actions/hr")
    if row['after_hours_activity'] > 50:
        reasons.append(f"  • 🌙 LATE NIGHT: {row['after_hours_activity']} events after hours")
        
    # 2. Check Data Exfiltration (File/USB)
    if row['removable_uploads'] > 0:
        reasons.append(f"  • 💾 USB UPLOAD: {row['removable_uploads']} files moved to USB")
    if row['file_copy_count'] > 200:
        reasons.append(f"  • 📂 MASS COPY: {row['file_copy_count']} files copied")
        
    # 3. Check Email Risk
    if row['total_email_size'] > 50000000: # 50MB
        reasons.append(f"  • 📧 LARGE DATA OUT: {row['total_email_size']/1000000:.1f} MB emailed")
    if row['email_sent_count'] > 500:
        reasons.append(f"  • 📨 SPAM/EXFIL: {row['email_sent_count']} emails sent")

    # 4. Check Decoy/Honeypot (Critical)
    if row['decoy_access_count'] > 0:
        reasons.append(f"  • 🚨 HONEYPOT TRIGGERED: Accessed {row['decoy_access_count']} decoy files!")

    # 5. Psychometric Flag
    if row['N'] > 80:
        reasons.append(f"  • 🧠 PSYCH: High Neuroticism Score ({row['N']})")
    if row['C'] < 20:
        reasons.append(f"  • 🧠 PSYCH: Very Low Conscientiousness ({row['C']})")

    # Print Reasons
    if reasons:
        print("   🚩 DETECTED BEHAVIORS:")
        for r in reasons:
            print(r)
    else:
        print("   🚩 REASON: Statistical anomaly across multiple minor features.")

    print("-" * 60)

print(f"\nTotal Anomalies Detected: {len(anomalies)} out of {len(df)} users.")