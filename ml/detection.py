import os
import json
import joblib
import logging
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timezone

# ==============================
# 1. Configuration (matching uba_server.py)
# ==============================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# Risk caps (same as server)
RISK_CAP_ANOMALY = 60
RISK_CAP_NORMAL = 59
MODEL_VERSION = "5.0.5"  # optional, not used in detection

BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DATA_DIR = BASE_DIR / "data" / "processed"
FEATURES_FILE = PROCESSED_DATA_DIR / "uba_features.csv"
OUTPUT_FILE = PROCESSED_DATA_DIR / "uba_predicted.csv"
METADATA_FILE = BASE_DIR / "uba_model_metadata.pkl"
NAMES_JSON_FILE = BASE_DIR / "readable_names.json"

# Load readable names (same as server)
if NAMES_JSON_FILE.exists():
    with open(NAMES_JSON_FILE, "r") as f:
        READABLE_NAMES = json.load(f)
else:
    # fallback minimal dict (server also has a default, but we can use empty)
    READABLE_NAMES = {}

# ==============================
# 2. Helper: fast_explain (copied from server)
# ==============================
def fast_explain(X_df, features_used, col_names, role_stats, role):
    """Generate detailed explanations listing the most deviating features."""
    explanations = []
    stats = role_stats.get(role, {})
    means = stats.get("means", {})
    stds = stats.get("stds", {})

    if not means or not stds:
        for _ in range(len(X_df)):
            explanations.append("Unusual behavior pattern detected (statistics unavailable).")
        return explanations

    vals = X_df[features_used].values
    for row in vals:
        z_scores = {}
        for i, feat in enumerate(features_used):
            mean = means.get(feat, 0)
            std = stds.get(feat, 1)
            if std == 0:
                z = 0
            else:
                z = (row[i] - mean) / std
            z_scores[feat] = abs(z)
        # top 3 features
        top_feats = sorted(z_scores, key=z_scores.get, reverse=True)[:3]
        top_names = [col_names[features_used.index(f)] for f in top_feats]
        explanations.append(f"Unusual behavior pattern detected ({', '.join(top_names)}).")
    return explanations

# ==============================
# 3. Main detection function (copied from server's run_detection)
# ==============================
def run_detection():
    logger.info("--- STARTING LOCAL THREAT DETECTION (Role-based) ---")
    if not FEATURES_FILE.exists():
        raise FileNotFoundError(f"❌ Features file missing: {FEATURES_FILE}")
    if not METADATA_FILE.exists():
        raise FileNotFoundError(f"❌ Model metadata missing: {METADATA_FILE}. Train the model first.")

    metadata = joblib.load(METADATA_FILE)
    features_used = metadata.get("features_used")
    role_models = metadata.get("role_models", {})
    role_stats = metadata.get("role_stats", {})
    if not features_used:
        raise ValueError("❌ Model metadata missing features list.")

    df_new = pd.read_csv(FEATURES_FILE)
    X_working = df_new.copy()

    # Prepare result columns
    df_new["anomaly_score"] = np.nan
    df_new["prediction"] = 1  # default normal
    df_new["risk_score"] = 0.0
    df_new["explanation"] = ""

    # Precompute readable column names once
    col_names = [READABLE_NAMES.get(col, col.replace('_', ' ')) for col in features_used]

    loaded_models = {}  # cache loaded models

    for role in df_new['role'].unique():
        # Determine which model to use
        if role not in role_models:
            if "__global__" in role_models:
                logger.info(f"⚠️ No specific model for role '{role}', using global fallback model.")
                model_key = "__global__"
            else:
                logger.warning(f"⚠️ No model found for role '{role}' and no global fallback, skipping these users.")
                continue
        else:
            model_key = role

        # Load model if not already loaded 
        if model_key not in loaded_models:
            model_path = role_models[model_key]
            if not os.path.exists(model_path):
                logger.error(f"Model file missing for {model_key}: {model_path}")
                continue
            loaded_models[model_key] = joblib.load(model_path)
            logger.info(f"📦 Loaded model for {model_key}.")

        model = loaded_models[model_key]
        mask = df_new['role'] == role
        role_df = X_working.loc[mask]

        # Select features
        missing = [col for col in features_used if col not in role_df.columns]
        if missing:
            raise ValueError(f"❌ Missing required columns for role '{role}': {missing}")

        X = role_df[features_used].fillna(0)
        X = X.replace([np.inf, -np.inf], 0)

        if X.empty:
            continue

        scores = model.score_samples(X)
        scores = np.clip(scores, scores.min(), scores.max())
        scores = scores.astype(np.float32)
        df_new.loc[mask, "anomaly_score"] = scores

        # IsolationForest's predict returns -1/1 based on its internal threshold
        preds = model.predict(X)
        df_new.loc[mask, "prediction"] = preds

        # Stable risk score calculation
        min_score = scores.min()
        max_score = scores.max()
        score_range = max_score - min_score
        if abs(score_range) < 1e-9:
            risk = np.zeros_like(scores)
        else:
            risk = ((max_score - scores) / score_range) * 100
        df_new.loc[mask, "risk_score"] = np.clip(risk, 0, 100).round(2).astype(float)

        # Explanation for anomalies
        df_new.loc[mask, 'explanation'] = "Behavior is normal."
        anomaly_mask_sub = preds == -1
        if anomaly_mask_sub.any():
            anomaly_indices = role_df.index[anomaly_mask_sub]
            explanations = fast_explain(
                X[anomaly_mask_sub],
                features_used,
                col_names,
                role_stats,
                model_key   # pass the key used for stats (role or __global__)
            )
            df_new.loc[anomaly_indices, 'explanation'] = pd.Series(explanations, index=anomaly_indices)

    # Fill any missing values (roles without any model)
    df_new['explanation'] = df_new['explanation'].fillna("Role not modeled, cannot evaluate.")

    df_new["prediction_label"] = df_new["prediction"].map({1: "Normal", -1: "Anomaly"})
    df_new.loc[df_new["prediction"] == -1, "risk_score"] = df_new.loc[df_new["prediction"] == -1, "risk_score"].clip(lower=RISK_CAP_ANOMALY)
    df_new.loc[df_new["prediction"] == 1, "risk_score"]  = df_new.loc[df_new["prediction"] == 1, "risk_score"].clip(upper=RISK_CAP_NORMAL)

    df_new["severity"] = np.select(
        [
            df_new["risk_score"] >= 80,
            df_new["risk_score"] >= 70,
            df_new["risk_score"] >= 60
        ],
        ["Critical", "High", "Medium"],
        default="Low"
    )

    df_new = df_new.sort_values("risk_score", ascending=False)
    df_new.to_csv(OUTPUT_FILE, index=False)

    logger.info(f"✅ Detection completed. Anomalies: {(df_new['prediction'] == -1).sum()} / {len(df_new)} users. Results saved to {OUTPUT_FILE}.")

# ==============================
# 4. Entry point
# ==============================
if __name__ == "__main__":
    run_detection()