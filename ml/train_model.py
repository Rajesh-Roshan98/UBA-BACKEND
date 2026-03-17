import os
import json
import joblib
import logging
import pandas as pd
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from sklearn.ensemble import IsolationForest

# ==============================
# 1. Configuration (matching uba_server.py)
# ==============================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

IQR_MULTIPLIER = 2.0
MAX_Z_CAP = 5
CHUNK_SIZE = 500000

CONTAMINATION_RATE = 0.02

DRIFT_7D_DIVISOR = 4.28
DRIFT_30D_DIVISOR = 3.0

RISK_CAP_ANOMALY = 60
RISK_CAP_NORMAL = 59

if RISK_CAP_ANOMALY <= RISK_CAP_NORMAL:
    raise ValueError(f"Configuration Error: RISK_CAP_ANOMALY ({RISK_CAP_ANOMALY}) must be strictly greater than RISK_CAP_NORMAL ({RISK_CAP_NORMAL})")

MODEL_VERSION = "5.0.5"

BASE_DIR = Path(__file__).resolve().parent
RAW_DATA_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DATA_DIR = BASE_DIR / "data" / "processed"
MODEL_REGISTRY_DIR = BASE_DIR / "models"
SQLITE_BUFFER = BASE_DIR / "temp_state.db"
NAMES_JSON_FILE = BASE_DIR / "readable_names.json"
LOCK_FILE = BASE_DIR / "uba_pipeline.lock"

PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
MODEL_REGISTRY_DIR.mkdir(parents=True, exist_ok=True)

FEATURES_FILE = PROCESSED_DATA_DIR / "uba_features.csv"
OUTPUT_FILE = PROCESSED_DATA_DIR / "uba_predicted.csv"
METADATA_FILE = BASE_DIR / "uba_model_metadata.pkl"

# Load readable names if available (optional, not used in training)
if NAMES_JSON_FILE.exists():
    with open(NAMES_JSON_FILE, "r") as f:
        READABLE_NAMES = json.load(f)
else:
    READABLE_NAMES = {}

# ==============================
# 2. Training Function (identical to uba_server.py)
# ==============================
def train_model():
    logger.info("--- STARTING PHASE 2: MODEL TRAINING (Role-based) ---")
    if not FEATURES_FILE.exists():
        raise FileNotFoundError(f"❌ Features file {FEATURES_FILE} not found.")

    df = pd.read_csv(FEATURES_FILE)
    if len(df) < 20:
        logger.warning("⚠️ Very small dataset detected. IsolationForest may be unstable.")

    # Best features for behavioral anomaly detection
    MODEL_FEATURES = [
        "login_per_day",
        "file_access_per_day",
        "file_copy_per_day",
        "email_sent_per_day",
        "avg_email_size",
        "attachment_count",
        "usb_upload_per_day",
        "usb_download_per_day",
        "device_usage_per_day",
        "device_connect_per_day",
        "device_disconnect_per_day",
        "avg_session_duration",
        "avg_active_hours_per_day",
        "decoy_access_per_day",
        "activity_per_day",
        "actions_per_hour",
        "after_hours_activity",
        "device_after_hours",
        "device_weekend_usage",
        "weekend_activity",
        "unique_pcs",
        "device_unique_pcs",
        "connect_disconnect_ratio",
        "drift_7d_vs_30d",
        "drift_30d_vs_90d"
    ]

    # Ensure all required columns exist
    missing = [col for col in MODEL_FEATURES if col not in df.columns]
    if missing:
        raise ValueError(f"❌ Missing required columns: {missing}")

    roles = df['role'].unique()
    role_models = {}
    role_stats = {}
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # Train per-role models
    for role in roles:
        logger.info(f"👥 Training model for role: {role}")
        role_df = df[df['role'] == role]
        if len(role_df) < 5:
            logger.warning(f"⚠️ Role '{role}' has only {len(role_df)} users, skipping (needs at least 5).")
            continue

        X = role_df[MODEL_FEATURES].fillna(0)
        X = X.replace([np.inf, -np.inf], 0)

        if X.empty:
            logger.warning(f"⚠️ Training data for role '{role}' is empty, skipping.")
            continue

        model = IsolationForest(
            n_estimators=150,
            contamination=CONTAMINATION_RATE,
            random_state=42,
            n_jobs=-1
        )
        model.fit(X)

        # Compute anomaly scores and derive threshold
        raw_scores = model.score_samples(X)
        raw_scores = np.clip(raw_scores, raw_scores.min(), raw_scores.max())
        Q1, Q3 = np.percentile(raw_scores, 25), np.percentile(raw_scores, 75)
        outlier_threshold = float(Q1 - (IQR_MULTIPLIER * (Q3 - Q1)))

        anomaly_flags = raw_scores < outlier_threshold
        percentage = (anomaly_flags.sum() / len(X)) * 100
        logger.info(f"📊 Role '{role}': {anomaly_flags.sum()} anomalies detected ({percentage:.2f}% of users)")

        safe_role = role.replace(' ', '_').replace('/', '_')
        model_filename = MODEL_REGISTRY_DIR / f"model_{safe_role}_{timestamp}.pkl"
        joblib.dump(model, model_filename)
        role_models[role] = model_filename

        means = X.mean().to_dict()
        stds = X.std().to_dict()
        role_stats[role] = {
            "means": means,
            "stds": stds,
            "threshold": outlier_threshold
        }
        logger.info(f"💾 Model for role '{role}' saved to {model_filename}")

    # Train global fallback model
    if len(role_models) < len(roles):
        logger.info("🌍 Training global fallback model for roles with insufficient data.")
        X_global = df[MODEL_FEATURES].fillna(0).replace([np.inf, -np.inf], 0)
        if not X_global.empty:
            model_global = IsolationForest(
                n_estimators=150,
                contamination=CONTAMINATION_RATE,
                random_state=42,
                n_jobs=-1
            )
            model_global.fit(X_global)

            raw_scores_global = model_global.score_samples(X_global)
            raw_scores_global = np.clip(raw_scores_global, raw_scores_global.min(), raw_scores_global.max())
            Q1g, Q3g = np.percentile(raw_scores_global, 25), np.percentile(raw_scores_global, 75)
            threshold_global = float(Q1g - (IQR_MULTIPLIER * (Q3g - Q1g)))

            global_model_filename = MODEL_REGISTRY_DIR / f"model___global___{timestamp}.pkl"
            joblib.dump(model_global, global_model_filename)
            role_models["__global__"] = global_model_filename

            means_global = X_global.mean().to_dict()
            stds_global = X_global.std().to_dict()
            role_stats["__global__"] = {
                "means": means_global,
                "stds": stds_global,
                "threshold": threshold_global
            }
            logger.info(f"💾 Global fallback model saved to {global_model_filename}")

    # Save metadata
    metadata = {
        "model_version": MODEL_VERSION,
        "training_timestamp": timestamp,
        "features_used": MODEL_FEATURES,
        "contamination": CONTAMINATION_RATE,
        "iqr_multiplier": IQR_MULTIPLIER,
        "role_models": {role: str(path) for role, path in role_models.items()},
        "role_stats": role_stats
    }
    joblib.dump(metadata, METADATA_FILE)

    logger.info(f"✅ UBA role-based models trained and metadata saved in {METADATA_FILE}")

# ==============================
# 3. Main entry point
# ==============================
if __name__ == "__main__":
    train_model()