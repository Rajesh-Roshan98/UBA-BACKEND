from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from contextlib import asynccontextmanager
from fastapi.concurrency import run_in_threadpool
import joblib
import logging
import os
import pandas as pd
import warnings
import numpy as np
import gc
from pathlib import Path

warnings.filterwarnings('ignore')

# ==============================
# 🚀 ENTERPRISE LOGGING SETUP
# ==============================
class HumanReadableFormatter(logging.Formatter):
    def format(self, record):
        timestamp = self.formatTime(record, self.datefmt)
        prefix = "✅ " if any(word in record.getMessage() for word in ["Success", "successfully", "Found"]) else "ℹ️ "
        if record.levelname in ['WARNING', 'ERROR', 'CRITICAL']:
            prefix = "⚠️ " if record.levelname == 'WARNING' else "🚨 "
        log_message = f"[{timestamp}] {record.levelname:8} | {prefix}{record.getMessage()}"
        if record.exc_info:
            log_message += f"\n{'='*60}\nERROR TRACEBACK:\n{self.formatException(record.exc_info)}\n{'='*60}"
        return log_message

logger = logging.getLogger()
logger.setLevel(logging.INFO)
for handler in logger.handlers[:]:
    logger.removeHandler(handler)
stream_handler = logging.StreamHandler()
stream_handler.setFormatter(HumanReadableFormatter(datefmt="%Y-%m-%d %H:%M:%S"))
logger.addHandler(stream_handler)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 UBA AI Engine Starting...")
    load_models()
    yield
    logger.info("🛑 UBA AI Engine Shutting Down Gracefully...")
    logger.info("✅ Shutdown completed successfully.")

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"status": "AI Engine Online"}

# ==============================
# 1️⃣ DIRECTORY SETUP & CONFIG
# ==============================
# FIX: Directories updated to perfectly match uba_server.py (removed "front")
BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "front" / "raw"
PROCESSED_DIR = BASE_DIR / "data" / "front" / "processed"
MODEL_REGISTRY_DIR = BASE_DIR / "data" / "front" / "models"

METADATA_FILE = BASE_DIR / "data" / "front" / "uba_model_metadata.pkl"
OUTPUT_FILE = PROCESSED_DIR / "uba_detected.csv"

RAW_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
MODEL_REGISTRY_DIR.mkdir(parents=True, exist_ok=True)

# Enterprise Configurations (mirror uba_server.py)
IQR_MULTIPLIER = float(os.getenv("UBA_IQR_MULTIPLIER", "2.0"))
MAX_Z_CAP = int(os.getenv("UBA_MAX_Z_CAP", "5"))
CONTAMINATION_RATE = float(os.getenv("UBA_CONTAMINATION", "0.02"))
RISK_CAP_ANOMALY = int(os.getenv("UBA_RISK_CAP_ANOMALY", "60"))
RISK_CAP_NORMAL = int(os.getenv("UBA_RISK_CAP_NORMAL", "59"))
DRIFT_7D_DIVISOR = float(os.getenv("UBA_DRIFT_7D_DIVISOR", "4.28"))
DRIFT_30D_DIVISOR = float(os.getenv("UBA_DRIFT_30D_DIVISOR", "3.0"))
MAX_TRAINING_ROWS = int(os.getenv("UBA_MAX_TRAINING_ROWS", "200000"))

# Global variables (aligned with uba_server.py structure)
role_models = {}          # role -> loaded model object
role_stats = {}           # role -> {"means": {...}, "stds": {...}} for explanations
features_used = []        # list of raw features used for training
role_score_ranges = {}    # role -> (min_score, max_score) for risk scaling
model_version = "5.0.5"   # same as uba_server.py

READABLE_NAMES = {
    "login_count": "login attempts", "file_access_count": "file access volume",
    "file_copy_count": "file copying activity", "removable_uploads": "uploads to USB drives",
    "removable_downloads": "downloads from USB drives", "email_sent_count": "number of emails sent",
    "total_email_size": "volume of email data", "attachment_count": "email attachments",
    "after_hours_activity": "after-hours system usage", "weekend_activity": "weekend system usage",
    "unique_pcs": "number of unique PCs accessed", "avg_email_size": "average email size",
    "device_activity_count": "USB/device activity", "device_connect_count": "device connections",
    "device_disconnect_count": "device disconnections", "device_unique_pcs": "unique PCs used for external devices",
    "device_after_hours": "after-hours device usage", "device_weekend_usage": "weekend device usage",
    "connect_disconnect_ratio": "device connection/disconnection ratio", "avg_session_duration": "average device session duration",
    "device_usage_per_day": "daily device usage frequency", "decoy_access_count": "accessing honey-pot decoy files", 
    "active_hours": "total time active in system", "actions_per_hour": "intensity of actions per hour",
    "window_7_days": "recent 7-day activity volume", "window_30_days": "recent 30-day activity volume",
    "baseline_90_days": "historical 90-day baseline activity", "drift_7d_vs_30d": "short-term behavioral drift",
    "drift_30d_vs_90d": "long-term behavioral drift",
    "login_per_day": "daily logins", "file_access_per_day": "daily file accesses",
    "file_copy_per_day": "daily file copies", "email_sent_per_day": "daily emails sent",
    "usb_upload_per_day": "daily USB uploads", "usb_download_per_day": "daily USB downloads",
    "device_connect_per_day": "daily device connections", "device_disconnect_per_day": "daily device disconnections",
    "decoy_access_per_day": "daily decoy accesses"
}

def load_models():
    """Load per‑role models and metadata (exactly as in uba_server.py)."""
    global role_models, role_stats, features_used, role_score_ranges
    role_models.clear()
    role_stats.clear()
    role_score_ranges.clear()

    if not METADATA_FILE.exists():
        logger.warning("No metadata file found. Models not loaded.")
        return

    try:
        meta = joblib.load(METADATA_FILE)
        features_used = meta.get("features_used", [])
        role_stats = meta.get("role_stats", {})
        role_score_ranges = meta.get("role_score_ranges", {})
        model_paths = meta.get("role_models", {})

        for role, path in model_paths.items():
            if os.path.exists(path):
                role_models[role] = joblib.load(path)
                logger.info(f"Loaded model for role '{role}' from {path}")
            else:
                logger.warning(f"Model file for role '{role}' not found: {path}")
        logger.info("All available models loaded.")
    except Exception as e:
        logger.error(f"Failed to load models: {e}", exc_info=True)

def fast_explain(X_df, features_used, col_names, role_stats, role):
    """
    Generate detailed explanations listing the most deviating features.
    Identical to uba_server.py's fast_explain.
    """
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
        top_feats = sorted(z_scores, key=z_scores.get, reverse=True)[:3]
        top_names = [col_names[features_used.index(f)] for f in top_feats]
        explanations.append(f"Unusual behavior pattern detected ({', '.join(top_names)}).")
    return explanations

# ==============================
# 2️⃣ SINGLE USER PREDICTION (aligned with uba_server.py detection)
# ==============================
class UserActivity(BaseModel):
    user_id: str
    role: str
    days_active: float = 1.0
    total_lifetime_hours: float = 1.0
    total_activity: float = 0.0
    login_count: float = 0.0
    unique_pcs: float = 0.0
    file_access_count: float = 0.0
    file_copy_count: float = 0.0
    removable_uploads: float = 0.0
    removable_downloads: float = 0.0
    decoy_access_count: float = 0.0
    after_hours_activity: float = 0.0
    weekend_activity: float = 0.0
    email_sent_count: float = 0.0
    total_email_size: float = 0.0
    attachment_count: float = 0.0
    device_activity_count: float = 0.0
    device_connect_count: float = 0.0
    device_disconnect_count: float = 0.0
    device_unique_pcs: float = 0.0
    device_after_hours: float = 0.0
    device_weekend_usage: float = 0.0
    avg_session_duration: float = 0.0
    window_7_days: float = 0.0
    window_30_days: float = 0.0
    baseline_90_days: float = 0.0

@app.post("/predict")
async def predict(data: UserActivity):
    try:
        if not role_models:
            return {"prediction": "Normal", "risk_score": 0, "message": "No models loaded. Train first.", "explanation": "No model available."}

        # Convert to DataFrame for feature engineering
        df_new = pd.DataFrame([data.dict()])

        # --- Feature engineering (mirror uba_server.py) ---
        df_new["login_per_day"] = (df_new["login_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["avg_active_hours_per_day"] = (df_new["total_lifetime_hours"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["device_usage_per_day"] = (df_new["device_activity_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["file_access_per_day"] = (df_new["file_access_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["file_copy_per_day"] = (df_new["file_copy_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["email_sent_per_day"] = (df_new["email_sent_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["usb_upload_per_day"] = (df_new["removable_uploads"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["usb_download_per_day"] = (df_new["removable_downloads"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["device_connect_per_day"] = (df_new["device_connect_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["device_disconnect_per_day"] = (df_new["device_disconnect_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["decoy_access_per_day"] = (df_new["decoy_access_count"] / df_new["days_active"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)

        df_new["actions_per_hour"] = (df_new["total_activity"] / df_new["total_lifetime_hours"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["activity_per_day"] = (
            df_new["total_activity"] / df_new["days_active"]
        ).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["avg_email_size"] = (df_new["total_email_size"] / df_new["email_sent_count"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)
        df_new["connect_disconnect_ratio"] = (df_new["device_connect_count"] / df_new["device_disconnect_count"]).replace([np.inf, -np.inf], 0).fillna(0).round(2)

        expected_30d = np.where(df_new["window_30_days"] > 0, df_new["window_30_days"] / DRIFT_7D_DIVISOR, 1)
        df_new["drift_7d_vs_30d"] = (df_new["window_7_days"] / expected_30d).replace([np.inf, -np.inf], 0).fillna(0).round(2)

        expected_90d = np.where(df_new["baseline_90_days"] > 0, df_new["baseline_90_days"] / DRIFT_30D_DIVISOR, 1)
        df_new["drift_30d_vs_90d"] = (df_new["window_30_days"] / expected_90d).replace([np.inf, -np.inf], 0).fillna(0).round(2)

        MODEL_FEATURES = [
            "login_per_day", "file_access_per_day", "file_copy_per_day",
            "email_sent_per_day", "avg_email_size", "attachment_count",
            "usb_upload_per_day", "usb_download_per_day", "device_usage_per_day",
            "device_connect_per_day", "device_disconnect_per_day", "avg_session_duration",
            "avg_active_hours_per_day", "decoy_access_per_day", "activity_per_day",
            "actions_per_hour", "after_hours_activity", "device_after_hours",
            "device_weekend_usage", "weekend_activity", "unique_pcs",
            "device_unique_pcs", "connect_disconnect_ratio", "drift_7d_vs_30d",
            "drift_30d_vs_90d"
        ]
        for col in MODEL_FEATURES:
            if col not in df_new.columns:
                df_new[col] = 0.0

        X = df_new[MODEL_FEATURES].fillna(0).replace([np.inf, -np.inf], 0)
        role = data.role

        # FIX: Implement Global Model Fallback for Live Predictions
        if role not in role_models:
            if "__global__" in role_models:
                logger.info(f"Role '{role}' not found. Falling back to __global__ model.")
                model_key = "__global__"
            else:
                raise HTTPException(status_code=400, detail=f"No model trained for role '{role}' and no global fallback available.")
        else:
            model_key = role

        model = role_models[model_key]
        pred = int(model.predict(X)[0])
        score = float(model.score_samples(X)[0])

        if model_key in role_score_ranges:
            min_s, max_s = role_score_ranges[model_key]
            denom = max(max_s - min_s, 1e-6)
            risk = ((max_s - score) / denom) * 100
        else:
            risk = 50.0
        risk = max(0.0, min(100.0, risk))
        risk = round(risk, 2)

        # Apply caps (same as uba_server.py)
        if pred == -1:
            risk = max(RISK_CAP_ANOMALY, risk)
        else:
            risk = min(RISK_CAP_NORMAL, risk)

        # Explanation (using role_stats)
        explanation = "Behavior is normal."
        if pred == -1:
            exp_df = X.copy()
            explanations = fast_explain(
                exp_df,
                MODEL_FEATURES,
                [READABLE_NAMES.get(col, col.replace('_', ' ')) for col in MODEL_FEATURES],
                role_stats,
                model_key
            )
            explanation = explanations[0] if explanations else "Anomaly detected."

        return {
            "prediction": "Anomaly" if pred == -1 else "Normal",
            "risk_score": risk,
            "explanation": explanation
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("API Error during prediction", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# ==============================
# 3️⃣ BULK TRAIN (using pre‑computed feature CSV)
# ==============================
@app.post("/train_batch")
async def train_batch():
    return await run_in_threadpool(_train_batch_sync)

def _train_batch_sync():
    try:
        allowed_names = {"uba_features.csv", "features.csv", "ubafeatures.csv", "feature.csv", "ubafeature.csv"}
        feature_path = None
        for fname in os.listdir(RAW_DIR):
            if fname.lower() in allowed_names:
                feature_path = os.path.join(RAW_DIR, fname)
                break

        if feature_path is None:
            raise HTTPException(
                status_code=400,
                detail="Feature file not found. Please upload the feature file (uba_features.csv, features.csv, ubafeatures.csv, feature.csv, or ubafeature.csv)."
            )

        logger.info(f"Loading feature file: {feature_path}")

        df = pd.read_csv(feature_path, low_memory=False)
        
        # FIX: Drop any completely blank rows and users with missing IDs before processing
        df = df.dropna(how='all')
        if 'user_id' in df.columns:
            df = df.dropna(subset=['user_id'])
            
        logger.info(f"Loaded {len(df)} valid rows from feature file.")

        expected_base_cols = [
            'user_id', 'employee_name', 'role', 'email',
            'days_active', 'total_lifetime_hours', 'total_activity',
            'login_count', 'unique_pcs', 'file_access_count', 'file_copy_count',
            'removable_uploads', 'removable_downloads', 'decoy_access_count',
            'after_hours_activity', 'weekend_activity', 'email_sent_count',
            'total_email_size', 'attachment_count', 'device_activity_count',
            'device_connect_count', 'device_disconnect_count', 'device_unique_pcs',
            'device_after_hours', 'device_weekend_usage', 'avg_session_duration',
            'window_7_days', 'window_30_days', 'baseline_90_days',
            'login_per_day', 'avg_active_hours_per_day', 'device_usage_per_day',
            'file_access_per_day', 'file_copy_per_day', 'email_sent_per_day',
            'usb_upload_per_day', 'usb_download_per_day',
            'device_connect_per_day', 'device_disconnect_per_day',
            'decoy_access_per_day', 'activity_per_day', 'actions_per_hour',
            'avg_email_size', 'connect_disconnect_ratio',
            'drift_7d_vs_30d', 'drift_30d_vs_90d'
        ]
        missing = [col for col in expected_base_cols if col not in df.columns]
        if missing:
            logger.warning(f"Missing columns in feature file: {missing}. Some will be filled with 0.")
            for col in missing:
                df[col] = 0.0

        if 'user_id' in df.columns:
            df['user_id'] = df['user_id'].astype(str).str.strip()
            df = df.drop_duplicates('user_id')

        MODEL_FEATURES = [
            "login_per_day", "file_access_per_day", "file_copy_per_day",
            "email_sent_per_day", "avg_email_size", "attachment_count",
            "usb_upload_per_day", "usb_download_per_day", "device_usage_per_day",
            "device_connect_per_day", "device_disconnect_per_day", "avg_session_duration",
            "avg_active_hours_per_day", "decoy_access_per_day", "activity_per_day",
            "actions_per_hour", "after_hours_activity", "device_after_hours",
            "device_weekend_usage", "weekend_activity", "unique_pcs",
            "device_unique_pcs", "connect_disconnect_ratio", "drift_7d_vs_30d",
            "drift_30d_vs_90d"
        ]
        for col in MODEL_FEATURES:
            if col not in df.columns:
                df[col] = 0.0

        roles = df['role'].unique()
        role_models_new = {}
        role_stats_new = {}
        role_score_ranges_new = {}
        timestamp = pd.Timestamp.now().strftime("%Y%m%d_%H%M%S")

        for role in roles:
            logger.info(f"👥 Training model for role: {role}")
            role_df = df[df['role'] == role]
            if len(role_df) < 5:
                logger.warning(f"Role '{role}' has only {len(role_df)} users, skipping.")
                continue

            X = role_df[MODEL_FEATURES].fillna(0).replace([np.inf, -np.inf], 0)
            if X.empty:
                continue

            model = IsolationForest(
                n_estimators=150,
                contamination=CONTAMINATION_RATE,
                random_state=42,
                n_jobs=-1
            )
            model.fit(X)

            means = X.mean().to_dict()
            stds = X.std().to_dict()
            role_stats_new[role] = {"means": means, "stds": stds}

            scores = model.score_samples(X)
            role_score_ranges_new[role] = (float(scores.min()), float(scores.max()))

            safe_role = role.replace(' ', '_').replace('/', '_')
            model_path = MODEL_REGISTRY_DIR / f"model_{safe_role}_{timestamp}.pkl"
            joblib.dump(model, model_path)
            role_models_new[role] = str(model_path)

            logger.info(f"Model for role '{role}' saved to {model_path}")

        # FIX: Train __global__ fallback model for roles that were skipped
        if len(role_models_new) < len(roles):
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

                scores_global = model_global.score_samples(X_global)
                role_score_ranges_new["__global__"] = (float(scores_global.min()), float(scores_global.max()))

                global_model_filename = MODEL_REGISTRY_DIR / f"model___global___{timestamp}.pkl"
                joblib.dump(model_global, global_model_filename)
                role_models_new["__global__"] = str(global_model_filename)

                means_global = X_global.mean().to_dict()
                stds_global = X_global.std().to_dict()
                role_stats_new["__global__"] = {
                    "means": means_global,
                    "stds": stds_global
                }
                logger.info(f"💾 Global fallback model saved to {global_model_filename}")

        if not role_models_new:
            raise HTTPException(status_code=500, detail="No models trained (insufficient data per role).")

        metadata = {
            "model_version": model_version,
            "training_timestamp": timestamp,
            "features_used": MODEL_FEATURES,
            "contamination": CONTAMINATION_RATE,
            "iqr_multiplier": IQR_MULTIPLIER,
            "role_models": role_models_new,
            "role_stats": role_stats_new,
            "role_score_ranges": role_score_ranges_new
        }
        joblib.dump(metadata, METADATA_FILE)

        load_models()

        output_df = df[expected_base_cols].copy()
        output_df['anomaly_score'] = np.nan
        output_df['prediction'] = 1
        output_df['risk_score'] = 0.0
        output_df['explanation'] = ""

        # FIX: Loop through ALL unique roles in output_df instead of only the ones with specific models
        for role in output_df['role'].unique():
            if role not in role_models:
                if "__global__" in role_models:
                    model_key = "__global__"
                else:
                    continue
            else:
                model_key = role

            model = role_models[model_key]
            mask = output_df['role'] == role
            if not mask.any():
                continue
                
            X_role = df.loc[mask, MODEL_FEATURES].fillna(0).replace([np.inf, -np.inf], 0)
            if X_role.empty:
                continue
                
            scores = model.score_samples(X_role)
            preds = model.predict(X_role)
            output_df.loc[mask, 'anomaly_score'] = scores
            output_df.loc[mask, 'prediction'] = preds

            min_s, max_s = role_score_ranges_new[model_key]
            denom = max(max_s - min_s, 1e-6)
            risk_vals = ((max_s - scores) / denom) * 100
            risk_vals = risk_vals.clip(0, 100)
            output_df.loc[mask, 'risk_score'] = risk_vals

        output_df.loc[output_df['prediction'] == -1, 'risk_score'] = output_df.loc[output_df['prediction'] == -1, 'risk_score'].clip(lower=RISK_CAP_ANOMALY)
        output_df.loc[output_df['prediction'] == 1, 'risk_score'] = output_df.loc[output_df['prediction'] == 1, 'risk_score'].clip(upper=RISK_CAP_NORMAL)

        # FIX: Explanations matching the fallback logic
        for role in output_df['role'].unique():
            mask = (output_df['role'] == role) & (output_df['prediction'] == -1)
            if not mask.any():
                continue
                
            if role in role_models_new:
                model_key = role
            elif "__global__" in role_models_new:
                model_key = "__global__"
            else:
                continue
                
            X_role = df.loc[mask, MODEL_FEATURES].fillna(0).replace([np.inf, -np.inf], 0)
            explanations = fast_explain(
                X_role,
                MODEL_FEATURES,
                [READABLE_NAMES.get(col, col.replace('_', ' ')) for col in MODEL_FEATURES],
                role_stats_new,
                model_key
            )
            output_df.loc[mask, 'explanation'] = explanations

        output_df['explanation'] = output_df['explanation'].fillna("Behavior is normal.")
        output_df['prediction_label'] = output_df['prediction'].map({1: "Normal", -1: "Anomaly"})
        output_df['severity'] = np.select(
            [output_df['risk_score'] >= 80, output_df['risk_score'] >= 70, output_df['risk_score'] >= 60],
            ["Critical", "High", "Medium"], default="Low"
        )
        output_df = output_df.sort_values('risk_score', ascending=False)

        output_df.to_csv(OUTPUT_FILE, index=False)
        logger.info(f"Detection output saved to {OUTPUT_FILE}")

        total_anomalies = (output_df['prediction'] == -1).sum()
        del df
        gc.collect()

        return {
            "success": True,
            "message": f"Trained {len(role_models_new)} role models. Anomalies: {total_anomalies} / {len(output_df)} users.",
            "total_processed": len(output_df)
        }

    except Exception as e:
        logger.error("API Error during batch training", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Enterprise UBA Server (v{model_version}) on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)