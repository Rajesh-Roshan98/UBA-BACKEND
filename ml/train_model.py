import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib
import os

# ----------------------------
# Paths
# ----------------------------
PROCESSED_DATA_DIR = "data/processed"
FEATURES_FILE = os.path.join(PROCESSED_DATA_DIR, "uba_features.csv")
MODEL_FILE = "uba_model.pkl"

# ----------------------------
# Load processed UBA features
# ----------------------------
df = pd.read_csv(FEATURES_FILE)

# ----------------------------
# Select relevant features for ML
# ----------------------------
features_list = [
    'login_count',
    'unique_pcs',
    'active_hours',
    'actions_per_hour',
    'file_access_count',
    'file_copy_count',
    'removable_uploads',
    'removable_downloads',
    'decoy_access_count'
]

X = df[features_list]

# ----------------------------
# Train Isolation Forest
# ----------------------------
model = IsolationForest(
    n_estimators=200,
    contamination=0.05,   # 5% expected anomalies
    random_state=42
)

model.fit(X)

# ----------------------------
# Save trained model
# ----------------------------
joblib.dump(model, MODEL_FILE)

print("✅ UBA model trained successfully")
print(f"📁 Model saved as: {MODEL_FILE}")
print(f"📊 Features used: {features_list}")
