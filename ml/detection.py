import pandas as pd
import joblib
import os

# ----------------------------
# Paths
# ----------------------------
FEATURES_FILE = "data/processed/uba_features.csv"
MODEL_FILE = "uba_model.pkl"
OUTPUT_FILE = "data/processed/uba_predicted.csv"

FEATURES = [
    "login_count",
    "unique_pcs",
    "active_hours",
    "actions_per_hour",
    "file_access_count",
    "file_copy_count",
    "removable_uploads",
    "removable_downloads",
    "decoy_access_count",
]

# ----------------------------
# Load features
# ----------------------------
df_new = pd.read_csv(FEATURES_FILE)
df_new["user_id"] = df_new["user_id"].astype(str).str.strip()

for col in FEATURES:
    if col not in df_new.columns:
        df_new[col] = 0

df_new[FEATURES] = df_new[FEATURES].fillna(0).replace([float("inf"), float("-inf")], 0)

# ----------------------------
# Load previous predictions if they exist
# ----------------------------
if os.path.exists(OUTPUT_FILE):
    df_old = pd.read_csv(OUTPUT_FILE)
    df_old["user_id"] = df_old["user_id"].astype(str).str.strip()
    df_old.set_index("user_id", inplace=True)
else:
    df_old = pd.DataFrame()

df_new.set_index("user_id", inplace=True)

# ----------------------------
# Load model
# ----------------------------
model = joblib.load(MODEL_FILE)

# ----------------------------
# Detect changed rows
# ----------------------------
changed_count = 0

for user_id, row in df_new.iterrows():
    X = row[FEATURES].to_frame().T
    pred = model.predict(X)[0]
    pred_label = "Anomaly" if pred == -1 else "Normal"

    # Check if row exists in old CSV
    if not df_old.empty and user_id in df_old.index:
        old_row = df_old.loc[user_id]

        # ✅ Detect if ANY feature or prediction changed
        feature_changed = any(row[FEATURES] != old_row[FEATURES])
        prediction_changed = (old_row["prediction"] != pred or old_row["prediction_label"] != pred_label)

        if feature_changed or prediction_changed:
            changed_count += 1

    else:
        # New row
        changed_count += 1

    # Update dataframe
    df_new.at[user_id, "prediction"] = pred
    df_new.at[user_id, "prediction_label"] = pred_label

# ----------------------------
# Preserve old rows that no longer exist in features
# ----------------------------
if not df_old.empty:
    for user_id in df_old.index:
        if user_id not in df_new.index:
            df_new.loc[user_id] = df_old.loc[user_id]

# ----------------------------
# Save output
# ----------------------------
df_new.reset_index(inplace=True)
df_new.to_csv(OUTPUT_FILE, index=False)

print(f"✅ Anomaly detection completed. Total rows updated/added: {changed_count}")
