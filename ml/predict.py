import sys
import os
import joblib
import pandas as pd
import warnings
import traceback

# Suppress sklearn warnings about feature names
warnings.filterwarnings('ignore')

# ==============================
# 1️⃣ CONFIG & PATHS 
# ==============================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_FILE = os.path.join(BASE_DIR, "uba_model.pkl")
SCALER_FILE = os.path.join(BASE_DIR, "uba_scaler.pkl")
METADATA_FILE = os.path.join(BASE_DIR, "uba_model_metadata.pkl")
FEATURES_FILE = os.path.join(BASE_DIR, "data", "processed", "uba_features.csv")
OUTPUT_FILE = os.path.join(BASE_DIR, "data", "processed", "uba_detected.csv")

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

READABLE_NAMES = {
    "login_count": "login attempts", "file_access_count": "file access volume",
    "file_copy_count": "file copying activity", "removable_uploads": "uploads to USB drives",
    "removable_downloads": "downloads from USB drives", "email_sent_count": "number of emails sent",
    "total_email_size": "volume of email data", "attachment_count": "email attachments",
    "after_hours_activity": "after-hours system usage", "weekend_activity": "weekend system usage",
    "unique_pcs": "number of unique PCs accessed", "avg_email_size": "average email size",
}

# ==============================================================================
# 🚀 MODE 1: BATCH PROCESSING (When run manually in terminal without arguments)
# ==============================================================================
if len(sys.argv) == 1:
    print("Loading model...")
    try:
        model = joblib.load(MODEL_FILE)
        scaler = joblib.load(SCALER_FILE)
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        sys.exit(1)

    metadata = {}
    role_stats = None
    score_min_train = None
    score_max_train = None

    if os.path.exists(METADATA_FILE):
        metadata = joblib.load(METADATA_FILE)
        role_stats = metadata.get("role_stats", None)
        score_min_train = metadata.get("score_min", None)
        score_max_train = metadata.get("score_max", None)
        print("Metadata Loaded")
    else:
        print("No metadata found. Using fallback logic.")

    MAX_Z_CAP = metadata.get("z_cap", 5)

    if not os.path.exists(FEATURES_FILE):
        print(f"❌ Error: Features file not found at {FEATURES_FILE}")
        sys.exit(1)

    df_new = pd.read_csv(FEATURES_FILE)
    X_working = df_new.copy()

    scalable_cols = [
        "login_count", "file_access_count", "file_copy_count", "removable_uploads", 
        "removable_downloads", "email_sent_count", "total_email_size", "attachment_count", 
        "after_hours_activity", "weekend_activity", "unique_pcs"
    ]

    if "days_active" in X_working.columns:
        days_divisor = X_working["days_active"].replace(0, 1)
        for col in scalable_cols:
            if col in X_working.columns:
                X_working[col] = X_working[col] / days_divisor

    ALL_Z_SCORE_COLS = scalable_cols + ["avg_email_size"]

    if "role" in X_working.columns:
        print("Computing role-based z-scores (fallback batch mode)...")
        for col in ALL_Z_SCORE_COLS:
            if col in X_working.columns:
                role_mean = X_working.groupby("role")[col].transform("mean")
                role_std = X_working.groupby("role")[col].transform(lambda x: x.std(ddof=0)).replace(0, 1)
                X_working[col + "_role_z"] = (X_working[col] - role_mean) / role_std
        for col in X_working.columns:
            if col.endswith("_role_z"):
                X_working[col] = X_working[col].clip(-MAX_Z_CAP, MAX_Z_CAP)

    if role_stats is not None and "role" in X_working.columns:
        print("Applying training-based role statistics...")
        for col in ALL_Z_SCORE_COLS:
            z_col = col + "_role_z"
            if col in X_working.columns and z_col in X_working.columns:
                for role in X_working["role"].unique():
                    if role in role_stats and col in role_stats[role]:
                        mean_val = role_stats[role][col]["mean"]
                        std_val = role_stats[role][col]["std"] or 1
                        mask = X_working["role"] == role
                        X_working.loc[mask, z_col] = (X_working.loc[mask, col] - mean_val) / std_val
        for col in X_working.columns:
            if col.endswith("_role_z"):
                X_working[col] = X_working[col].clip(-MAX_Z_CAP, MAX_Z_CAP)

    features_used = metadata.get("features_used")
    X_working = X_working.fillna(0)

    if features_used:
        for col in features_used:
            if col not in X_working.columns:
                X_working[col] = 0
        X_model = X_working[features_used]
    else:
        raise ValueError("features_used missing from metadata")

    X_scaled = scaler.transform(X_model)

    print("Calculating Risk Scores...")
    df_new["anomaly_score"] = model.score_samples(X_scaled)

    if score_min_train is not None and score_max_train is not None:
        min_score = score_min_train
        max_score = score_max_train
    else:
        min_score = df_new["anomaly_score"].min()
        max_score = df_new["anomaly_score"].max()

    if abs(max_score - min_score) < 1e-9:
        df_new["risk_score"] = 0
    else:
        df_new["risk_score"] = ((max_score - df_new["anomaly_score"]) / (max_score - min_score)) * 100

    df_new["risk_score"] = df_new["risk_score"].clip(0, 100).round(2)
    df_new["prediction"] = model.predict(X_scaled)
    X_working["prediction"] = df_new["prediction"]

    role_z_columns = [col for col in X_working.columns if col.endswith("_role_z")]

    def generate_explanation(row):
        if row["prediction"] == 1:
            return "Behavior is normal and matches typical role patterns."
        z_scores = {col: row[col] for col in role_z_columns if col in row}
        significant = {k: v for k, v in z_scores.items() if abs(v) >= 2.0}
        if not significant:
            return "Behavior deviates slightly but not strongly abnormal."
        top_features = sorted(significant.items(), key=lambda x: abs(x[1]), reverse=True)[:3]
        explanations = [f"{'Unusually high' if v > 0 else 'Unusually low'} {READABLE_NAMES.get(f.replace('_role_z', ''), f.replace('_role_z', '').replace('_', ' '))}" for f, v in top_features]
        return " • ".join(explanations)

    df_new["explanation"] = X_working.apply(generate_explanation, axis=1)
    df_new["prediction_label"] = df_new["prediction"].map({1: "Normal", -1: "Anomaly"})

    df_new.loc[df_new["prediction"] == -1, "risk_score"] = df_new.loc[df_new["prediction"] == -1, "risk_score"].clip(lower=60)
    df_new.loc[df_new["prediction"] == 1, "risk_score"] = df_new.loc[df_new["prediction"] == 1, "risk_score"].clip(upper=59)

    def get_severity(row):
        if row["risk_score"] >= 80: return "Critical"
        if row["risk_score"] >= 70: return "High"
        if row["risk_score"] >= 60: return "Medium"
        return "Low"

    df_new["severity"] = df_new.apply(get_severity, axis=1)
    df_new = df_new.sort_values("risk_score", ascending=False)
    
    df_new.to_csv(OUTPUT_FILE, index=False)

    print("-" * 30)
    print("Detection Completed.")
    print(f"   Anomalies Found: {(df_new['prediction'] == -1).sum()}")
    print(f"   Total Users: {len(df_new)}")
    print(f"   Output: data/processed/uba_detected.csv")
    print("-" * 30)


# ==============================================================================
# 🚀 MODE 2: REAL-TIME PREDICTION (Triggered by Node.js passing arguments)
# ==============================================================================
else:
    try:
        model = joblib.load(MODEL_FILE)
        scaler = joblib.load(SCALER_FILE)
        metadata = joblib.load(METADATA_FILE)
        role_stats = metadata.get("role_stats", None)
        score_min_train = metadata.get("score_min", None)
        score_max_train = metadata.get("score_max", None)
        MAX_Z_CAP = metadata.get("z_cap", 5)
    except Exception as e:
        print(f"Error loading models: {e}", file=sys.stderr)
        print("Normal")
        sys.exit(1)

    EXPECTED_MIN_ARGS = 14  
    if len(sys.argv) < EXPECTED_MIN_ARGS:
        print(f"Missing arguments. Expected at least {EXPECTED_MIN_ARGS}, got {len(sys.argv)}", file=sys.stderr)
        print("Normal")
        sys.exit(1)

    try:
        actual_days_active = float(sys.argv[14]) if len(sys.argv) > 14 else 1.0
        actual_role = sys.argv[15] if len(sys.argv) > 15 else "Unknown"
        actual_user_id = sys.argv[16] if len(sys.argv) > 16 else "Unknown_User"

        input_data = {
            "user_id": actual_user_id, 
            "login_count": float(sys.argv[1]),
            "unique_pcs": float(sys.argv[2]),
            "active_hours": float(sys.argv[3]),
            "actions_per_hour": float(sys.argv[4]),
            "file_access_count": float(sys.argv[5]),
            "file_copy_count": float(sys.argv[6]),
            "removable_uploads": float(sys.argv[7]),
            "removable_downloads": float(sys.argv[8]),
            "decoy_access_count": float(sys.argv[9]),
            "after_hours_activity": float(sys.argv[11]),
            "days_active": actual_days_active, 
            "role": actual_role 
        }
    except ValueError as e:
        print(f"Value Error parsing arguments: {e}", file=sys.stderr)
        print("Normal")
        sys.exit(1)

    df_new = pd.DataFrame([input_data])
    X_working = df_new.copy()

    scalable_cols = [
        "login_count", "file_access_count", "file_copy_count", "removable_uploads", 
        "removable_downloads", "email_sent_count", "total_email_size", "attachment_count", 
        "after_hours_activity", "weekend_activity", "unique_pcs"
    ]

    days_divisor = X_working["days_active"].replace(0, 1)
    for col in scalable_cols:
        if col in X_working.columns:
            X_working[col] = X_working[col] / days_divisor

    ALL_Z_SCORE_COLS = scalable_cols + ["avg_email_size"]

    if role_stats is not None:
        for col in ALL_Z_SCORE_COLS:
            z_col = col + "_role_z"
            if col in X_working.columns:
                role_to_use = input_data["role"]
                if role_to_use not in role_stats:
                    role_to_use = "Unknown" if "Unknown" in role_stats else list(role_stats.keys())[0]
                
                if role_to_use in role_stats and col in role_stats[role_to_use]:
                    mean_val = role_stats[role_to_use][col]["mean"]
                    std_val = role_stats[role_to_use][col]["std"] or 1
                    X_working[z_col] = (X_working[col] - mean_val) / std_val
                    X_working[z_col] = X_working[z_col].clip(-MAX_Z_CAP, MAX_Z_CAP)

    features_used = metadata.get("features_used", [])

    if not features_used:
        print("Metadata error: features_used is empty", file=sys.stderr)
        print("Normal")
        sys.exit(1)

    X_working = X_working.fillna(0)
    for col in features_used:
        if col not in X_working.columns:
            X_working[col] = 0

    X_model = X_working[features_used]

    try:
        X_scaled = scaler.transform(X_model)
        prediction = model.predict(X_scaled)[0]
        anomaly_score = model.score_samples(X_scaled)[0]
        
        df_new["prediction"] = prediction
        df_new["anomaly_score"] = anomaly_score
        
        if score_min_train is not None and score_max_train is not None:
            if abs(score_max_train - score_min_train) < 1e-9:
                df_new["risk_score"] = 0
            else:
                df_new["risk_score"] = ((score_max_train - anomaly_score) / (score_max_train - score_min_train)) * 100
        else:
            df_new["risk_score"] = 50 
            
        df_new["risk_score"] = df_new["risk_score"].clip(0, 100).round(2)
        
        if prediction == -1:
            df_new["risk_score"] = max(df_new["risk_score"][0], 60)
        else:
            df_new["risk_score"] = min(df_new["risk_score"][0], 59)

        score = df_new["risk_score"][0]
        if score >= 80: df_new["severity"] = "Critical"
        elif score >= 70: df_new["severity"] = "High"
        elif score >= 60: df_new["severity"] = "Medium"
        else: df_new["severity"] = "Low"

        role_z_columns = [col for col in X_working.columns if col.endswith("_role_z")]

        if prediction == 1:
            df_new["explanation"] = "Behavior is normal and matches typical role patterns."
        else:
            z_scores = {col: X_working.iloc[0][col] for col in role_z_columns if col in X_working.columns}
            significant = {k: v for k, v in z_scores.items() if abs(v) >= 2.0}
            
            if not significant:
                df_new["explanation"] = "Behavior deviates slightly but not strongly abnormal."
            else:
                top_features = sorted(significant.items(), key=lambda x: abs(x[1]), reverse=True)[:3]
                explanations = [f"{'Unusually high' if v > 0 else 'Unusually low'} {READABLE_NAMES.get(f.replace('_role_z', ''), f.replace('_role_z', '').replace('_', ' '))}" for f, v in top_features]
                df_new["explanation"] = " • ".join(explanations)

        df_new["prediction_label"] = "Anomaly" if prediction == -1 else "Normal"
        
        file_exists = os.path.isfile(OUTPUT_FILE)
        df_new.to_csv(OUTPUT_FILE, mode='a', header=not file_exists, index=False)
        
        try:
            df_saved = pd.read_csv(OUTPUT_FILE)
            total_records = len(df_saved)
            total_anomalies = (df_saved["prediction"] == -1).sum()
            
            user_col = next((col for col in ['user_id', 'email', 'employee_name', 'role'] if col in df_saved.columns), None)
            unique_users = df_saved[user_col].nunique() if user_col else "N/A"
            users_with_anomaly = df_saved[df_saved["prediction"] == -1][user_col].nunique() if user_col else "N/A"
            
            print("\n" + "="*45, file=sys.stderr)
            print("LIVE DETECTION LOGGED", file=sys.stderr)
            print("="*45, file=sys.stderr)
            print(f"Total Actions Logged:    {total_records}", file=sys.stderr)
            print(f"Total Anomalies Found:   {total_anomalies}", file=sys.stderr)
            print(f"Unique Users Monitored:  {unique_users}", file=sys.stderr)
            print(f"Users with Anomalies:    {users_with_anomaly}", file=sys.stderr)
            print("="*45 + "\n", file=sys.stderr)
        except Exception:
            pass
        
        # 🟢 THIS IS THE ONLY THING NODE.JS READS 🟢
        print("Anomaly" if prediction == -1 else "Normal")

    except Exception as e:
        print(f"CRITICAL ERROR in predict.py: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        print("Normal")
        sys.exit(1)