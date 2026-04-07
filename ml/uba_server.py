import os
import json
import joblib
import logging
import sqlite3
import pandas as pd
import numpy as np
import time  
import asyncio 
import gc  # Added for memory optimization 
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from sklearn.ensemble import IsolationForest
from contextlib import asynccontextmanager

# --- FASTAPI & ENTERPRISE IMPORTS ---
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security.api_key import APIKeyHeader
from filelock import FileLock  

try:
    from redis import Redis
    USE_REDIS = True
except (ImportError, ValueError):
    USE_REDIS = False

# ==============================
# 1. Enterprise Configuration & Globals
# ==============================
class HumanReadableFormatter(logging.Formatter):
    """Outputs logs in a clean, human-readable terminal format."""
    def format(self, record):
        timestamp = self.formatTime(record, self.datefmt)
        
        # Add visual markers for success messages vs standard info
        prefix = "✅ " if "Success" in record.getMessage() or "Completed" in record.getMessage() else "ℹ️ "
        if record.levelname in ['WARNING', 'ERROR', 'CRITICAL']:
            prefix = "⚠️ " if record.levelname == 'WARNING' else "🚨 "
            
        log_message = f"[{timestamp}] {record.levelname:8} | {prefix}{record.getMessage()}"
        
        # Formatting errors/tracebacks specifically to be human-readable
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

# --- Configuration Management ---
IQR_MULTIPLIER = float(os.getenv("UBA_IQR_MULTIPLIER", "2.0"))
MAX_Z_CAP = int(os.getenv("UBA_MAX_Z_CAP", "5"))
CHUNK_SIZE = int(os.getenv("UBA_CHUNK_SIZE", "500000"))

CONTAMINATION_RATE = float(os.getenv("UBA_CONTAMINATION", "0.02"))

DRIFT_7D_DIVISOR = float(os.getenv("UBA_DRIFT_7D_DIVISOR", "4.28"))
DRIFT_30D_DIVISOR = float(os.getenv("UBA_DRIFT_30D_DIVISOR", "3.0"))

RISK_CAP_ANOMALY = int(os.getenv("UBA_RISK_CAP_ANOMALY", "60"))
RISK_CAP_NORMAL = int(os.getenv("UBA_RISK_CAP_NORMAL", "59"))

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
# For role-based models, we will save multiple files; keep a mapping
MODEL_FILE = BASE_DIR / "uba_model.pkl"  # will be replaced by role models
METADATA_FILE = BASE_DIR / "uba_model_metadata.pkl"

try:
    if USE_REDIS:
        redis_conn = Redis(host=os.getenv("REDIS_HOST", "localhost"), port=6379, decode_responses=True)
        redis_conn.ping() 
except Exception as e:
    logger.warning(f"Redis unavailable. Rate limiting will use local memory: {e}")
    USE_REDIS = False

API_KEY = os.getenv("UBA_API_KEY", "cloud_uba")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)                    

async def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API Key")
    return api_key

local_rate_limit = defaultdict(list)

async def rate_limit(api_key: str = Depends(verify_api_key)):
    """Enterprise Rate Limiter (Redis-backed with local memory fallback). Max 10 calls per minute."""
    now = time.time()
    if USE_REDIS:
        key = f"rate_limit:{api_key}"
        # Use pipeline to avoid race conditions
        pipe = redis_conn.pipeline()
        pipe.incr(key)
        pipe.expire(key, 60)
        results = pipe.execute()
        current = results[0]
        if current >= 10:
            raise HTTPException(status_code=429, detail="Too Many Requests. Rate limit exceeded.")
    else:
        local_rate_limit[api_key] = [t for t in local_rate_limit[api_key] if now - t < 60]
        if len(local_rate_limit[api_key]) >= 10:
            raise HTTPException(status_code=429, detail="Too Many Requests. Rate limit exceeded.")
        local_rate_limit[api_key].append(now)
    return api_key

if not NAMES_JSON_FILE.exists():
    default_names = {
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
    with open(NAMES_JSON_FILE, "w") as f:
        json.dump(default_names, f)

with open(NAMES_JSON_FILE, "r") as f:
    READABLE_NAMES = json.load(f)

RAW_SCHEMAS = {
    "users.csv": ["user_id", "employee_name", "role", "email"],
    "logon.csv": ["user_id", "date", "activity", "pc"],
    "file.csv": ["user_id", "date", "activity", "filename",  "to_removable_media", "from_removable_media"],
    "email.csv": ["user_id", "date", "activity", "size", "attachments"],
    "device.csv": ["user_id", "date", "activity", "pc"],
    "decoy_file.csv": ["decoy_filename"] 
}

# ==============================
# 2. Helper Functions
# ==============================
def safe_to_datetime(df: pd.DataFrame, col: str) -> pd.DataFrame:
    if col in df.columns:
        # Removed format='mixed' for broader compatibility
        df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

def init_sqlite_buffer():
    conn = sqlite3.connect(SQLITE_BUFFER, timeout=60.0)
    # Performance pragmas
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=FILE")
    conn.execute("PRAGMA journal_mode=WAL;") 
    conn.execute("PRAGMA cache_size=-100000")  # IMPROVEMENT: Increase cache size for better read performance
    conn.execute("DROP TABLE IF EXISTS daily_counts")
    conn.execute("DROP TABLE IF EXISTS tracking_sets")
    conn.execute("DROP TABLE IF EXISTS device_state")
    conn.execute("CREATE TABLE daily_counts (user_id TEXT, day TEXT, cnt INTEGER)")
    conn.execute("CREATE TABLE tracking_sets (user_id TEXT, type TEXT, val TEXT)")
    conn.execute("CREATE TABLE device_state (user_pc TEXT PRIMARY KEY, state_json TEXT)")
    conn.commit()
    return conn

def validate_raw_schema(file_path: Path, expected_cols: list):
    if not file_path.exists(): return True 
    sample = pd.read_csv(file_path, nrows=1)
    cols = [c if c != 'user' else 'user_id' for c in sample.columns]
    missing = set(expected_cols) - set(cols)
    if missing:
        raise ValueError(f"RAW SCHEMA MISMATCH in {file_path.name}: Missing required columns {missing}")
    return True

def cleanup_cache():
    """Removes temporary SQLite cache and WAL files to free up disk space."""
    logger.info("Cleaning up temporary cache files to free storage...")
    for ext in ["", "-wal", "-shm"]:
        target_file = Path(str(SQLITE_BUFFER) + ext)
        if target_file.exists():
            try:
                os.remove(target_file)
            except OSError as e:
                logger.warning(f"Could not remove cache file {target_file}: {e}")

# NEW: Safer user column detection
def detect_user_column(cols):
    if "user_id" in cols:
        return "user_id"
    elif "user" in cols:
        return "user"
    else:
        raise ValueError("No user column found in CSV")

# ==============================
# 3. Pipeline Step 1: Feature Extraction (Optimized)
# ==============================
def extract_features():
    logger.info("--- STARTING PHASE 1: FEATURE EXTRACTION (Optimized) ---")
    
    for fname, cols in RAW_SCHEMAS.items():
        validate_raw_schema(RAW_DATA_DIR / fname, cols)
        
    try:
        users_df = pd.read_csv(RAW_DATA_DIR / "users.csv")
    except FileNotFoundError:
        logger.error("Failed to load users dataset.", exc_info=True) 
        return

    if 'user' in users_df.columns: users_df.rename(columns={'user': 'user_id'}, inplace=True)
    users_df['user_id'] = users_df['user_id'].astype(str).str.strip()
    features = users_df[['user_id', 'employee_name', 'role', 'email']].drop_duplicates('user_id').set_index('user_id')
    
    db_conn = init_sqlite_buffer()

    # --- Initialize aggregation list ---
    agg_list = []

    # Buffers for batch SQLite writes
    daily_buffer = []
    track_buffer = []
    BATCH_SIZE = 10  # write every 10 chunks

    def flush_sqlite_buffers():
        nonlocal daily_buffer, track_buffer
        if daily_buffer:
            pd.concat(daily_buffer, ignore_index=True).to_sql(
                'daily_counts', db_conn, if_exists='append', index=False, chunksize=100
            )
            daily_buffer.clear()
        if track_buffer:
            pd.concat(track_buffer, ignore_index=True).to_sql(
                'tracking_sets', db_conn, if_exists='append', index=False, chunksize=100
            )
            track_buffer.clear()

    def update_disk_tracking(chunk, pc_tracking=False, pc_type='pc'):
        # Drop rows with invalid dates
        chunk = chunk.dropna(subset=['date'])
        chunk['day'] = chunk['date'].dt.normalize().astype(str)
        chunk['hr'] = chunk['date'].dt.floor('h').astype(str)
        
        counts = chunk.groupby(['user_id', 'day'], observed=True).size().reset_index(name='cnt')
        daily_buffer.append(counts)
        
        days_df = chunk[['user_id', 'day']].rename(columns={'day': 'val'}).drop_duplicates()
        days_df['type'] = 'day'
        
        hrs_df = chunk[['user_id', 'hr']].rename(columns={'hr': 'val'}).drop_duplicates()
        hrs_df['type'] = 'hr'
        
        tracking_df = pd.concat([days_df, hrs_df])
        
        if pc_tracking and 'pc' in chunk.columns:
            pc_df = chunk[['user_id', 'pc']].rename(columns={'pc': 'val'}).drop_duplicates()
            pc_df['type'] = pc_type 
            tracking_df = pd.concat([tracking_df, pc_df])
            
        track_buffer.append(tracking_df)

        if len(daily_buffer) >= BATCH_SIZE:
            flush_sqlite_buffers()

    # --- Read column names once per file for usecols ---
    # FIX: Check file existence before reading to avoid crashes
    logon_path = RAW_DATA_DIR / "logon.csv"
    if logon_path.exists():
        logon_cols = pd.read_csv(logon_path, nrows=0).columns
        logon_user_col = detect_user_column(logon_cols)  # Safer detection
    else:
        logon_user_col = "user_id"  # default, will be used if file missing

    file_path = RAW_DATA_DIR / "file.csv"
    if file_path.exists():
        file_cols = pd.read_csv(file_path, nrows=0).columns
        file_user_col = detect_user_column(file_cols)    # Safer detection
    else:
        file_user_col = "user_id"

    email_path = RAW_DATA_DIR / "email.csv"
    if email_path.exists():
        email_cols = pd.read_csv(email_path, nrows=0).columns
        email_user_col = detect_user_column(email_cols)  # Safer detection
    else:
        email_user_col = "user_id"

    device_path = RAW_DATA_DIR / "device.csv"
    if device_path.exists():
        device_cols = pd.read_csv(device_path, nrows=0).columns
        device_user_col = detect_user_column(device_cols)  # Safer detection
    else:
        device_user_col = "user_id"

    # --- 1. PROCESS LOGONS ---
    logger.info("🔍 Processing login events from logon.csv...")
    if not (RAW_DATA_DIR / "logon.csv").exists():
        logger.warning("logon.csv not found, skipping.")
    else:
        logon_total = None
        chunk_counter = 0
        try:
            for chunk in pd.read_csv(
                RAW_DATA_DIR / "logon.csv",
                usecols=[logon_user_col, 'date', 'activity', 'pc'],
                chunksize=CHUNK_SIZE
            ):
                chunk_counter += 1
                chunk.rename(columns={logon_user_col: 'user_id'}, inplace=True)
                # IMPROVEMENT: Use string instead of category for better cross-chunk performance
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')
                
                update_disk_tracking(chunk, pc_tracking=True, pc_type='pc')
                
                if 'activity' in chunk.columns: chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else: chunk['activity'] = ''
                
                chunk['is_login'] = chunk['activity'].str.contains('logon|login', na=False).astype(int)
                dt_vals = chunk['date'].dt
                chunk['hour'] = dt_vals.hour
                chunk['weekday'] = dt_vals.weekday
                # Precompute flags for faster aggregation
                chunk['after_hours_flag'] = (~chunk['hour'].between(9, 18)).astype(np.int8)
                chunk['weekend_flag'] = (chunk['weekday'] >= 5).astype(np.int8)
                
                chunk_agg = chunk.groupby('user_id', observed=True).agg(
                    login_count=('is_login', 'sum'),
                    after_hours_activity=('after_hours_flag', 'sum'),
                    weekend_activity=('weekend_flag', 'sum')
                )
                if logon_total is None:
                    logon_total = chunk_agg
                else:
                    logon_total = logon_total.add(chunk_agg, fill_value=0)
                
                # Free memory (throttled) - every 20 chunks
                del chunk
                if chunk_counter % 50 == 0:
                    gc.collect()
                
                # Periodic WAL checkpoint to control growth
                if chunk_counter % 50 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e: 
            logger.error(f"❌ Failed to process logon.csv. Error: {e}", exc_info=True)

        if logon_total is not None:
            logon_total.index = logon_total.index.astype(str)
            agg_list.append(logon_total)
            logger.info("✅ Successfully processed login events.")

    # --- 2. PROCESS FILES & DECOYS ---
    logger.info("🔍 Processing file access and decoy events from file.csv...")
    if not (RAW_DATA_DIR / "file.csv").exists():
        logger.warning("file.csv not found, skipping.")
    else:
        decoy_file_path = RAW_DATA_DIR / "decoy_file.csv"
        if decoy_file_path.exists():
            decoy_df = pd.read_csv(decoy_file_path)
            # IMPROVEMENT: Normalize decoy filenames for case‑insensitive matching
            decoy_set = set(
                decoy_df["decoy_filename"]
                .astype(str)
                .str.strip()
                .str.lower()
            )
            logger.info(f"📄 Decoy file list loaded with {len(decoy_set)} entries (case‑insensitive).")
        else:
            decoy_df = pd.DataFrame()
            decoy_set = set()
            logger.info("📄 No decoy file list found, proceeding without decoy tracking.")
            
        file_total = None
        decoy_total = None
        chunk_counter = 0
        try:
            for chunk in pd.read_csv(
                RAW_DATA_DIR / "file.csv",
                usecols=[file_user_col, 'date', 'activity', 'filename', 'to_removable_media', 'from_removable_media'],
                chunksize=CHUNK_SIZE
            ):
                chunk_counter += 1
                chunk.rename(columns={file_user_col: 'user_id'}, inplace=True)
                # IMPROVEMENT: Use string instead of category
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')
                
                update_disk_tracking(chunk)
                
                if 'activity' in chunk.columns: chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else: chunk['activity'] = ''
                
                # Vectorized boolean conversion
                for col in ['to_removable_media', 'from_removable_media']:
                    if col in chunk.columns:
                        chunk[col] = chunk[col].astype(str).str.lower().isin(['true', '1', 'yes']).astype(np.int8)
                    else:
                        chunk[col] = 0

                chunk['is_copy'] = chunk['activity'].str.contains('copy', na=False).astype(int)
                
                file_agg = chunk.groupby('user_id', observed=True).agg(
                    file_access_count=('activity', 'count'),
                    file_copy_count=('is_copy', 'sum'),
                    removable_uploads=('to_removable_media', 'sum'),
                    removable_downloads=('from_removable_media', 'sum')
                )
                if file_total is None:
                    file_total = file_agg
                else:
                    file_total = file_total.add(file_agg, fill_value=0)
                
                # IMPROVEMENT: Faster decoy detection with normalization
                if decoy_set and 'filename' in chunk.columns:
                    chunk['filename_norm'] = chunk['filename'].fillna("").str.strip().str.lower()
                    chunk['is_decoy'] = chunk['filename_norm'].isin(decoy_set)
                    decoy_hits = chunk[chunk['is_decoy']]
                    if not decoy_hits.empty:
                        decoy_agg = decoy_hits.groupby('user_id', observed=True).size()
                        if decoy_total is None:
                            decoy_total = decoy_agg
                        else:
                            decoy_total = decoy_total.add(decoy_agg, fill_value=0)

                # Free memory (throttled) - every 20 chunks
                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                
                # Periodic WAL checkpoint
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e: 
            logger.error(f"❌ Failed to process file.csv. Error: {e}", exc_info=True)

        if file_total is not None:
            file_total.index = file_total.index.astype(str)
            agg_list.append(file_total)
            logger.info("✅ Successfully processed file access events.")
            
        if decoy_total is not None:
            decoy_total.index = decoy_total.index.astype(str)
            decoy_series = decoy_total.rename('decoy_access_count')
            agg_list.append(decoy_series.to_frame())
            logger.info("✅ Decoy access events processed.")
        else:
            dummy = pd.Series(0, index=features.index, name='decoy_access_count')
            agg_list.append(dummy.to_frame())
            logger.info("ℹ️ No decoy accesses recorded.")

    # --- 3. PROCESS EMAILS ---
    logger.info("🔍 Processing email events from email.csv...")
    if not (RAW_DATA_DIR / "email.csv").exists():
        logger.warning("email.csv not found, skipping.")
    else:
        email_total = None
        chunk_counter = 0
        try:
            for chunk in pd.read_csv(
                RAW_DATA_DIR / "email.csv",
                usecols=[email_user_col, 'date', 'activity', 'size', 'attachments'],
                chunksize=CHUNK_SIZE
            ):
                chunk_counter += 1
                chunk.rename(columns={email_user_col: 'user_id'}, inplace=True)
                # IMPROVEMENT: Use string instead of category
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')
                
                update_disk_tracking(chunk)
                
                chunk['size'] = pd.to_numeric(chunk.get('size', 0), errors='coerce').fillna(0)
                if 'attachments' in chunk.columns:
                    # FIXED: handle empty strings correctly
                    chunk['attachments'] = (
                        chunk['attachments']
                        .fillna('')
                        .astype(str)
                        .apply(lambda x: 0 if x.strip() == '' else len(x.split(';')))
                    )
                    chunk['attachments'] = chunk['attachments'].astype(int)
                else: 
                    chunk['attachments'] = 0
                
                if 'activity' in chunk.columns:
                    chunk['activity'] = chunk['activity'].astype(str).str.lower()
                    sent_emails = chunk[chunk['activity'].str.contains('send', na=False)]
                else:
                    sent_emails = chunk
                    
                email_agg = sent_emails.groupby('user_id', observed=True).agg(
                    email_sent_count=('user_id', 'count'),
                    total_email_size=('size', 'sum'),
                    attachment_count=('attachments', 'sum')
                )
                if email_total is None:
                    email_total = email_agg
                else:
                    email_total = email_total.add(email_agg, fill_value=0)
                
                # Free memory (throttled) - every 20 chunks
                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                
                # Periodic WAL checkpoint
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e: 
            logger.error(f"❌ Failed to process email.csv. Error: {e}", exc_info=True)

        if email_total is not None:
            email_total.index = email_total.index.astype(str)
            agg_list.append(email_total)
            logger.info("✅ Successfully processed email events.")

    # --- 4. PROCESS DEVICES & SESSIONS ---
    logger.info("🔍 Processing device events from device.csv...")
    if not (RAW_DATA_DIR / "device.csv").exists():
        logger.warning("device.csv not found, skipping.")
    else:
        device_total = None
        session_total = None
        chunk_counter = 0
        
        try:
            for chunk in pd.read_csv(
                RAW_DATA_DIR / "device.csv",
                usecols=[device_user_col, 'date', 'activity', 'pc'],
                chunksize=CHUNK_SIZE
            ):
                chunk_counter += 1
                chunk.rename(columns={device_user_col: 'user_id'}, inplace=True)
                # IMPROVEMENT: Use string instead of category
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')
                
                update_disk_tracking(chunk, pc_tracking=True, pc_type='device_pc')
                
                if 'activity' in chunk.columns: chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else: chunk['activity'] = ''
                
                dt_vals = chunk['date'].dt
                chunk['hour'] = dt_vals.hour if 'date' in chunk.columns else 0
                chunk['weekday'] = dt_vals.weekday if 'date' in chunk.columns else 0
                chunk['is_connect'] = (chunk['activity'] == 'connect').astype(int)
                chunk['is_disconnect'] = (chunk['activity'] == 'disconnect').astype(int)
                # Precompute flags
                chunk['device_after_hours_flag'] = (~chunk['hour'].between(9, 18)).astype(np.int8)
                chunk['device_weekend_flag'] = (chunk['weekday'] >= 5).astype(np.int8)
                
                device_agg = chunk.groupby('user_id', observed=True).agg(
                    device_activity_count=('activity', 'count'),
                    device_connect_count=('is_connect', 'sum'),
                    device_disconnect_count=('is_disconnect', 'sum'),
                    device_after_hours=('device_after_hours_flag', 'sum'),
                    device_weekend_usage=('device_weekend_flag', 'sum')
                )
                if device_total is None:
                    device_total = device_agg
                else:
                    device_total = device_total.add(device_agg, fill_value=0)

                if 'date' in chunk.columns and 'pc' in chunk.columns:
                    chunk['user_pc'] = chunk['user_id'].astype(str) + "_" + chunk['pc'].astype(str)
                    
                    unique_upcs = chunk['user_pc'].unique()
                    cached_states_list = []
                    BATCH_FETCH = 1000
                    for i in range(0, len(unique_upcs), BATCH_FETCH):
                        batch_upcs = unique_upcs[i:i+BATCH_FETCH]
                        if len(batch_upcs) == 0:
                            continue
                        placeholders = ','.join(['?'] * len(batch_upcs))
                        query = f"SELECT user_pc, state_json FROM device_state WHERE user_pc IN ({placeholders})"
                        batch_states = pd.read_sql(query, db_conn, params=tuple(batch_upcs))
                        cached_states_list.append(batch_states)
                    
                    cached_states = pd.concat(cached_states_list) if cached_states_list else pd.DataFrame()

                    if not cached_states.empty:
                        # Filter out null state_json entries before loading
                        valid_states = [x for x in cached_states['state_json'] if pd.notna(x)]
                        if valid_states:
                            prev_df = pd.DataFrame([json.loads(x) for x in valid_states])
                            prev_df['date'] = pd.to_datetime(prev_df['date'])
                            chunk = pd.concat([prev_df, chunk], ignore_index=True)
                    
                    chunk.sort_values(by=['user_id', 'pc', 'date'], inplace=True)
                    chunk['prev_activity'] = chunk.groupby(['user_id', 'pc'], observed=True)['activity'].shift(1)
                    chunk['prev_date'] = chunk.groupby(['user_id', 'pc'], observed=True)['date'].shift(1)
                    
                    valid_sessions = chunk[(chunk['activity'] == 'disconnect') & (chunk['prev_activity'] == 'connect')].copy()
                    if not valid_sessions.empty:
                        valid_sessions['dur'] = (valid_sessions['date'] - valid_sessions['prev_date']).dt.total_seconds() / 3600.0
                        session_agg = valid_sessions.groupby('user_id', observed=True).agg(dur_sum=('dur', 'sum'), dur_cnt=('dur', 'count'))
                        if session_total is None:
                            session_total = session_agg
                        else:
                            session_total = session_total.add(session_agg, fill_value=0)
                    
                    last_rows = chunk.groupby(['user_id', 'pc'], observed=True).last().reset_index()
                    last_rows['date'] = last_rows['date'].astype(str)
                    
                    # Optimize stored JSON: only keep necessary fields
                    records = []
                    for row in last_rows.to_dict('records'):
                        state = {
                            "user_id": row["user_id"],
                            "pc": row["pc"],
                            "activity": row["activity"],
                            "date": row["date"]
                        }
                        records.append((f"{row['user_id']}_{row['pc']}", json.dumps(state, default=str)))
                    db_conn.executemany("INSERT OR REPLACE INTO device_state (user_pc, state_json) VALUES (?, ?)", records)

                # Free memory (throttled) - every 20 chunks
                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                
                # Periodic WAL checkpoint
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")

            # Commit after processing all device chunks
            db_conn.commit()

            if device_total is not None:
                device_total.index = device_total.index.astype(str)
                agg_list.append(device_total)
                logger.info("✅ Successfully processed device activity events.")
                
            if session_total is not None:
                session_total.index = session_total.index.astype(str)
                session_total['avg_session_duration'] = (session_total['dur_sum'] / session_total['dur_cnt']).replace([np.inf, -np.inf], 0).fillna(0)
                agg_list.append(session_total[['avg_session_duration']])
                logger.info("✅ Device session durations calculated.")
            else:
                dummy = pd.Series(0, index=features.index, name='avg_session_duration')
                agg_list.append(dummy.to_frame())
                logger.info("ℹ️ No device sessions recorded.")
        except Exception as e: 
            logger.error(f"❌ Failed to process device.csv. Error: {e}", exc_info=True)

    # Flush any remaining SQLite buffers
    flush_sqlite_buffers()

    # --- 5. AGGREGATE LIFETIME ACTIVITY ---
    logger.info("📊 Calculating final behavioral ratios and rolling drift...")
    
    set_counts = pd.read_sql("SELECT user_id, type, COUNT(DISTINCT val) as c FROM tracking_sets GROUP BY user_id, type", db_conn)
    set_pivoted = set_counts.pivot(index='user_id', columns='type', values='c').fillna(0)
    for col in ['day', 'hr', 'pc', 'device_pc']:
        if col not in set_pivoted.columns:
            set_pivoted[col] = 0
    set_pivoted = set_pivoted.rename(columns={
        'day': 'days_active',
        'hr': 'total_lifetime_hours',
        'pc': 'unique_pcs',
        'device_pc': 'device_unique_pcs'
    })
    agg_list.append(set_pivoted)

    # --- Combine all aggregated dataframes at once ---
    logger.info("🔗 Merging all aggregated features...")
    # IMPROVEMENT: More memory efficient merging
    agg_combined = pd.concat(agg_list, axis=1)
    del agg_list
    gc.collect()
    features = features.join(agg_combined, how='left')

    numeric_cols = features.select_dtypes(include=np.number).columns
    features[numeric_cols] = features[numeric_cols].fillna(0).astype(np.float32)

    essential_base_cols = [
        'login_count', 'file_access_count', 'email_sent_count',
        'removable_uploads', 'removable_downloads', 'decoy_access_count',
        'device_activity_count', 'total_email_size', 'device_connect_count',
        'device_disconnect_count', 'after_hours_activity', 'weekend_activity',
        'unique_pcs', 'device_after_hours', 'device_weekend_usage', 'device_unique_pcs', 'file_copy_count'
    ]
    for col in essential_base_cols:
        if col not in features.columns:
            features[col] = 0

    if 'days_active' not in features.columns:
        features['days_active'] = 1
    safe_days = features['days_active'].replace(0, 1)

    features['login_per_day'] = (features['login_count'] / safe_days).round(2)
    features['avg_active_hours_per_day'] = (features['total_lifetime_hours'] / safe_days).round(2)
    features['device_usage_per_day'] = (features['device_activity_count'] / safe_days).round(2)

    features['file_access_per_day'] = (features['file_access_count'] / safe_days).round(2)
    features['file_copy_per_day'] = (features['file_copy_count'] / safe_days).round(2)
    features['email_sent_per_day'] = (features['email_sent_count'] / safe_days).round(2)
    features['usb_upload_per_day'] = (features['removable_uploads'] / safe_days).round(2)
    features['usb_download_per_day'] = (features['removable_downloads'] / safe_days).round(2)
    features['device_connect_per_day'] = (features['device_connect_count'] / safe_days).round(2)
    features['device_disconnect_per_day'] = (features['device_disconnect_count'] / safe_days).round(2)
    features['decoy_access_per_day'] = (features['decoy_access_count'] / safe_days).round(2)

    features['total_activity'] = (
        features['login_count'] +
        features['file_access_count'] +
        features['email_sent_count'] +
        features['file_copy_count'] +
        features['removable_uploads'] +
        features['removable_downloads'] +
        features['device_activity_count'] +
        features['after_hours_activity']
    )

    features['activity_per_day'] = (
        features['total_activity'] / safe_days
    ).round(2)

    features['avg_email_size'] = (features['total_email_size'] / features['email_sent_count']).replace([np.inf, -np.inf], 0).fillna(0).round(2)
    
    safe_hours = features['total_lifetime_hours'].replace(0, 1)
    features['actions_per_hour'] = (features['total_activity'] / safe_hours).round(2)
    
    features['connect_disconnect_ratio'] = (features['device_connect_count'] / features['device_disconnect_count']).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    # --- 6. MEMORY-SAFE ROLLING WINDOW MATH ---
    unique_users = pd.read_sql("SELECT DISTINCT user_id FROM daily_counts", db_conn)['user_id'].tolist()
    
    if unique_users:
        window_frames = []
        for i in range(0, len(unique_users), 5000):
            batch_users = unique_users[i:i+5000]
            placeholders = ','.join(['?'] * len(batch_users))
            query = f"SELECT user_id, day, SUM(cnt) as cnt FROM daily_counts WHERE user_id IN ({placeholders}) GROUP BY user_id, day"
            user_daily = pd.read_sql(query, db_conn, params=tuple(batch_users))
            
            user_daily['day'] = pd.to_datetime(user_daily['day'])
            max_dates = user_daily.groupby('user_id')['day'].transform('max')
            user_daily['time_diff'] = max_dates - user_daily['day']
            
            w7 = user_daily[user_daily['time_diff'] <= pd.Timedelta(days=7)].groupby('user_id')['cnt'].sum().rename('window_7_days')
            w30 = user_daily[user_daily['time_diff'] <= pd.Timedelta(days=30)].groupby('user_id')['cnt'].sum().rename('window_30_days')
            w90 = user_daily[user_daily['time_diff'] <= pd.Timedelta(days=90)].groupby('user_id')['cnt'].sum().rename('baseline_90_days')
            
            window_frames.append(pd.concat([w7, w30, w90], axis=1).fillna(0))
            
        if window_frames:
            all_windows = pd.concat(window_frames)
            features = features.join(all_windows, how='left')
            
            features[['window_7_days', 'window_30_days', 'baseline_90_days']] = features[['window_7_days', 'window_30_days', 'baseline_90_days']].fillna(0)
            
            expected_30d = np.where(features['window_30_days'] > 0, features['window_30_days'] / DRIFT_7D_DIVISOR, 1)
            features['drift_7d_vs_30d'] = (features['window_7_days'] / expected_30d).replace([np.inf, -np.inf], 0).fillna(0).round(2)
            
            expected_90d = np.where(features['baseline_90_days'] > 0, features['baseline_90_days'] / DRIFT_30D_DIVISOR, 1)
            features['drift_30d_vs_90d'] = (features['window_30_days'] / expected_90d).replace([np.inf, -np.inf], 0).fillna(0).round(2)
            logger.info("📈 Rolling window and drift features computed.")
    else:
        for col in ['window_7_days', 'window_30_days', 'baseline_90_days', 'drift_7d_vs_30d', 'drift_30d_vs_90d']:
            features[col] = 0
        logger.info("ℹ️ No user activity found for rolling window calculations.")

    # Truncate WAL before closing
    db_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db_conn.close()

    required_columns = [
        'user_id', 'employee_name', 'role', 'email',
        'days_active', 'total_lifetime_hours', 'total_activity',
        'login_count', 'login_per_day', 'unique_pcs',
        'avg_active_hours_per_day', 'actions_per_hour',
        'after_hours_activity', 'weekend_activity',
        'file_access_count', 'file_copy_count',
        'removable_uploads', 'removable_downloads',
        'decoy_access_count', 'avg_email_size',
        'email_sent_count', 'total_email_size', 'attachment_count', 'activity_per_day',
        'device_activity_count', 'device_connect_count', 'device_disconnect_count', 
        'device_unique_pcs', 'device_after_hours', 'device_weekend_usage', 'device_usage_per_day', 
        'connect_disconnect_ratio', 'avg_session_duration',
        'window_7_days', 'window_30_days', 'baseline_90_days', 'drift_7d_vs_30d', 'drift_30d_vs_90d',
        'file_access_per_day', 'file_copy_per_day', 'email_sent_per_day', 'usb_upload_per_day', 
        'usb_download_per_day', 'device_connect_per_day', 'device_disconnect_per_day', 'decoy_access_per_day'
    ]

    for col in required_columns:
        if col not in features.columns and col != 'user_id':
            features[col] = 0

    features.reset_index(inplace=True)
    
    final_df = features[required_columns].drop_duplicates('user_id')

    final_df.to_csv(FEATURES_FILE, index=False)
    logger.info(f"✅ Successfully processed {len(final_df)} users. Feature file saved to {FEATURES_FILE}.")

    # Free memory
    del features
    gc.collect()

    # UPDATED: Call cleanup_cache to remove temp files after extraction
    cleanup_cache()

# ==============================
# 4. Pipeline Step 2: Train Model (Role-based)
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
    role_stats = {}  # store feature statistics per role
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # First, train per-role models for roles with enough data
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

        # IMPROVEMENT: Use 'auto' contamination for better robustness
        model = IsolationForest(
            n_estimators=150,
            contamination=CONTAMINATION_RATE,
            random_state=42,
            n_jobs=-1
        )
        model.fit(X)

        # Compute anomaly scores and derive threshold (for metadata)
        raw_scores = model.score_samples(X)
        raw_scores = np.clip(raw_scores, raw_scores.min(), raw_scores.max())
        Q1, Q3 = np.percentile(raw_scores, 25), np.percentile(raw_scores, 75)
        outlier_threshold = float(Q1 - (IQR_MULTIPLIER * (Q3 - Q1)))

        anomaly_flags = raw_scores < outlier_threshold
        percentage = (anomaly_flags.sum() / len(X)) * 100
        logger.info(f"📊 Role '{role}': {anomaly_flags.sum()} anomalies detected ({percentage:.2f}% of users)")

        # Save model with role name
        safe_role = role.replace(' ', '_').replace('/', '_')
        model_filename = MODEL_REGISTRY_DIR / f"model_{safe_role}_{timestamp}.pkl"
        joblib.dump(model, model_filename)
        role_models[role] = model_filename

        # compute and store feature means, stds, and threshold for this role
        means = X.mean().to_dict()
        stds = X.std().to_dict()
        role_stats[role] = {
            "means": means,
            "stds": stds,
            "threshold": outlier_threshold
        }
        logger.info(f"💾 Model for role '{role}' saved to {model_filename}")

    # NEW: Train a global fallback model using all data (for roles that were skipped)
    # Only if there are any roles that were skipped (i.e., total roles > models trained)
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

            # Compute stats for global model
            raw_scores_global = model_global.score_samples(X_global)
            raw_scores_global = np.clip(raw_scores_global, raw_scores_global.min(), raw_scores_global.max())
            Q1g, Q3g = np.percentile(raw_scores_global, 25), np.percentile(raw_scores_global, 75)
            threshold_global = float(Q1g - (IQR_MULTIPLIER * (Q3g - Q1g)))

            # Save global model
            global_model_filename = MODEL_REGISTRY_DIR / f"model___global___{timestamp}.pkl"
            joblib.dump(model_global, global_model_filename)
            role_models["__global__"] = global_model_filename

            # Global stats
            means_global = X_global.mean().to_dict()
            stds_global = X_global.std().to_dict()
            role_stats["__global__"] = {
                "means": means_global,
                "stds": stds_global,
                "threshold": threshold_global
            }
            logger.info(f"💾 Global fallback model saved to {global_model_filename}")

    # Save metadata mapping roles to model files
    metadata = {
        "model_version": MODEL_VERSION,
        "training_timestamp": timestamp,
        "features_used": MODEL_FEATURES,
        "contamination": CONTAMINATION_RATE,
        "iqr_multiplier": IQR_MULTIPLIER,
        "role_models": {role: str(path) for role, path in role_models.items()},
        "role_stats": role_stats  # includes threshold per role now
    }
    joblib.dump(metadata, METADATA_FILE)

    logger.info(f"✅ UBA role-based models trained and metadata saved in {METADATA_FILE}")

# ==============================
# 5. Pipeline Step 3: Detection (Role-based)
# ==============================
def fast_explain(X_df, features_used, col_names, role_stats, role):
    """Generate detailed explanations listing the most deviating features."""
    explanations = []
    # Retrieve means and stds for this role
    stats = role_stats.get(role, {})
    means = stats.get("means", {})
    stds = stats.get("stds", {})
    # If statistics missing, fallback to generic message
    if not means or not stds:
        for _ in range(len(X_df)):
            explanations.append("Unusual behavior pattern detected (statistics unavailable).")
        return explanations

    vals = X_df[features_used].values
    for row in vals:
        # Compute z-scores
        z_scores = {}
        for i, feat in enumerate(features_used):
            mean = means.get(feat, 0)
            std = stds.get(feat, 1)
            if std == 0:
                z = 0
            else:
                z = (row[i] - mean) / std
            z_scores[feat] = abs(z)
        # Get top 3 features with largest absolute z-scores
        top_feats = sorted(z_scores, key=z_scores.get, reverse=True)[:3]
        top_names = [col_names[features_used.index(f)] for f in top_feats]
        explanations.append(f"Unusual behavior pattern detected ({', '.join(top_names)}).")
    return explanations

def run_detection():
    logger.info("--- STARTING PHASE 3: THREAT DETECTION (Role-based) ---")
    if not FEATURES_FILE.exists():
        raise FileNotFoundError("❌ Features file missing.")
    if not METADATA_FILE.exists():
        raise FileNotFoundError("❌ Model metadata missing. Train the model before running detection.")

    metadata = joblib.load(METADATA_FILE)
    features_used = metadata.get("features_used")
    role_models = metadata.get("role_models", {})
    role_stats = metadata.get("role_stats", {})  # load statistics (includes threshold now)
    if not features_used:
        raise ValueError("❌ Model metadata missing features list.")

    df_new = pd.read_csv(FEATURES_FILE)
    X_working = df_new.copy()

    # Load models lazily (could cache, but here load per role as needed)
    # We'll store loaded models in a dict to avoid reloading for each user
    loaded_models = {}

    # Prepare result columns
    df_new["anomaly_score"] = np.nan
    df_new["prediction"] = 1  # default normal
    df_new["risk_score"] = 0.0
    df_new["explanation"] = ""

    # NEW: Precompute readable column names once
    col_names = [READABLE_NAMES.get(col, col.replace('_', ' ')) for col in features_used]

    for role in df_new['role'].unique():
        # NEW: If role has no dedicated model, use global fallback if available
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
            # NEW: Check if model file exists before loading
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

        # Use per-role threshold? For simplicity, use the model's decision function directly
        # IsolationForest's predict returns -1/1 based on threshold internally
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

        # Simple explanation for anomalies
        df_new.loc[mask, 'explanation'] = "Behavior is normal."
        anomaly_mask_sub = preds == -1
        if anomaly_mask_sub.any():
            anomaly_indices = role_df.index[anomaly_mask_sub]
            # call enhanced explain with role_stats (use model_key for stats)
            explanations = fast_explain(
                X[anomaly_mask_sub],
                features_used,
                col_names,  # use precomputed list
                role_stats,
                model_key   # pass the actual key used for stats (role or __global__)
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
# 6. Modular FastAPI Server Initialization
# ==============================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 UBA Server started.")
    yield
    logger.info("🛑 UBA Server shutting down gracefully...")
    cleanup_cache()
    logger.info("✅ Cleanup completed.")

app = FastAPI(
    title="Modular UBA Detection API",
    description="Enterprise ML pipeline endpoints for detecting cloud data exfiltration.",
    version=MODEL_VERSION,
    lifespan=lifespan
)

@app.get("/")
async def root():
    return {
        "service": "UBA Detection API",
        "status": "running",
        "version": MODEL_VERSION
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/extract-features")
async def api_extract_features(api_key: str = Depends(rate_limit)):
    start_time = time.time()
    try:
        with FileLock(str(LOCK_FILE), timeout=60):
            await asyncio.to_thread(extract_features)
        latency = time.time() - start_time
        return {"status": "success", "message": "Feature extraction completed successfully.", "latency_seconds": round(latency, 2)}
    except TimeoutError:
        raise HTTPException(status_code=409, detail="Pipeline is currently locked by another process.")
    except Exception as e:
        logger.error("API Error", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cleanup_cache()

@app.post("/train-model")
async def api_train_model(api_key: str = Depends(rate_limit)):
    start_time = time.time()
    try:
        with FileLock(str(LOCK_FILE), timeout=60):
            await asyncio.to_thread(train_model)
        latency = time.time() - start_time
        return {"status": "success", "message": "Model training completed successfully.", "latency_seconds": round(latency, 2)}
    except TimeoutError:
        raise HTTPException(status_code=409, detail="Pipeline is currently locked by another process.")
    except Exception as e:
        logger.error("API Error", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/run-detection")
async def api_run_detection(api_key: str = Depends(rate_limit)):
    start_time = time.time()
    try:
        with FileLock(str(LOCK_FILE), timeout=60):
            await asyncio.to_thread(run_detection)
        latency = time.time() - start_time
        return {"status": "success", "message": "Threat detection completed successfully.", "latency_seconds": round(latency, 2)}
    except TimeoutError:
        raise HTTPException(status_code=409, detail="Pipeline is currently locked by another process.")
    except Exception as e:
        logger.error("API Error", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Enterprise UBA Server (v{MODEL_VERSION}) on port 5000...")
    uvicorn.run(app, host="0.0.0.0", port=5000)