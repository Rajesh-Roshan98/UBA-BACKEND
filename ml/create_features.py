import os
import json
import sqlite3
import pandas as pd
import numpy as np
import gc
from pathlib import Path
from collections import defaultdict

# ==============================
# 1. Configuration (matching uba_server.py)
# ==============================
BASE_DIR = Path(__file__).resolve().parent
RAW_DATA_DIR = BASE_DIR / "data" / "raw"
PROCESSED_DATA_DIR = BASE_DIR / "data" / "processed"
SQLITE_BUFFER = BASE_DIR / "temp_state.db"
NAMES_JSON_FILE = BASE_DIR / "readable_names.json"

PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)

FEATURES_FILE = PROCESSED_DATA_DIR / "uba_features.csv"

# Configuration variables used in extraction
CHUNK_SIZE = 500000
DRIFT_7D_DIVISOR = 4.28
DRIFT_30D_DIVISOR = 3.0

# ==============================
# 2. Helper Functions (from server)
# ==============================
def safe_to_datetime(df: pd.DataFrame, col: str) -> pd.DataFrame:
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

def init_sqlite_buffer():
    conn = sqlite3.connect(SQLITE_BUFFER, timeout=60.0)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=FILE")
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA cache_size=-100000")
    conn.execute("DROP TABLE IF EXISTS daily_counts")
    conn.execute("DROP TABLE IF EXISTS tracking_sets")
    conn.execute("DROP TABLE IF EXISTS device_state")
    conn.execute("CREATE TABLE daily_counts (user_id TEXT, day TEXT, cnt INTEGER)")
    conn.execute("CREATE TABLE tracking_sets (user_id TEXT, type TEXT, val TEXT)")
    conn.execute("CREATE TABLE device_state (user_pc TEXT PRIMARY KEY, state_json TEXT)")
    conn.commit()
    return conn

def validate_raw_schema(file_path: Path, expected_cols: list):
    if not file_path.exists():
        return True
    sample = pd.read_csv(file_path, nrows=1)
    cols = [c if c != 'user' else 'user_id' for c in sample.columns]
    missing = set(expected_cols) - set(cols)
    if missing:
        raise ValueError(f"RAW SCHEMA MISMATCH in {file_path.name}: Missing required columns {missing}")
    return True

def cleanup_cache():
    """Removes temporary SQLite cache and WAL files."""
    print("Cleaning up temporary cache files...")
    for ext in ["", "-wal", "-shm"]:
        target_file = Path(str(SQLITE_BUFFER) + ext)
        if target_file.exists():
            try:
                os.remove(target_file)
            except OSError as e:
                print(f"Warning: Could not remove cache file {target_file}: {e}")

def detect_user_column(cols):
    if "user_id" in cols:
        return "user_id"
    elif "user" in cols:
        return "user"
    else:
        raise ValueError("No user column found in CSV")

# ==============================
# 3. Feature Extraction (chunked, same as server)
# ==============================
def extract_features():
    print("--- STARTING PHASE 1: FEATURE EXTRACTION (Optimized) ---")

    # Define expected schemas
    RAW_SCHEMAS = {
        "users.csv": ["user_id", "employee_name", "role", "email"],
        "logon.csv": ["user_id", "date", "activity", "pc"],
        "file.csv": ["user_id", "date", "activity", "filename", "to_removable_media", "from_removable_media"],
        "email.csv": ["user_id", "date", "activity", "size", "attachments"],
        "device.csv": ["user_id", "date", "activity", "pc"],
        "decoy_file.csv": ["decoy_filename"]
    }

    for fname, cols in RAW_SCHEMAS.items():
        validate_raw_schema(RAW_DATA_DIR / fname, cols)

    try:
        users_df = pd.read_csv(RAW_DATA_DIR / "users.csv")
    except FileNotFoundError:
        print("ERROR: Failed to load users dataset.")
        return

    if 'user' in users_df.columns:
        users_df.rename(columns={'user': 'user_id'}, inplace=True)
    users_df['user_id'] = users_df['user_id'].astype(str).str.strip()
    features = users_df[['user_id', 'employee_name', 'role', 'email']].drop_duplicates('user_id').set_index('user_id')

    db_conn = init_sqlite_buffer()
    agg_list = []
    daily_buffer = []
    track_buffer = []
    BATCH_SIZE = 10

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

    # --- Determine user column names per file ---
    logon_path = RAW_DATA_DIR / "logon.csv"
    if logon_path.exists():
        logon_cols = pd.read_csv(logon_path, nrows=0).columns
        logon_user_col = detect_user_column(logon_cols)
    else:
        logon_user_col = "user_id"

    file_path = RAW_DATA_DIR / "file.csv"
    if file_path.exists():
        file_cols = pd.read_csv(file_path, nrows=0).columns
        file_user_col = detect_user_column(file_cols)
    else:
        file_user_col = "user_id"

    email_path = RAW_DATA_DIR / "email.csv"
    if email_path.exists():
        email_cols = pd.read_csv(email_path, nrows=0).columns
        email_user_col = detect_user_column(email_cols)
    else:
        email_user_col = "user_id"

    device_path = RAW_DATA_DIR / "device.csv"
    if device_path.exists():
        device_cols = pd.read_csv(device_path, nrows=0).columns
        device_user_col = detect_user_column(device_cols)
    else:
        device_user_col = "user_id"

    # --- 1. PROCESS LOGONS ---
    print("🔍 Processing login events from logon.csv...")
    if not (RAW_DATA_DIR / "logon.csv").exists():
        print("logon.csv not found, skipping.")
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
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')

                update_disk_tracking(chunk, pc_tracking=True, pc_type='pc')

                if 'activity' in chunk.columns:
                    chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else:
                    chunk['activity'] = ''

                chunk['is_login'] = chunk['activity'].str.contains('logon|login', na=False).astype(int)
                dt_vals = chunk['date'].dt
                chunk['hour'] = dt_vals.hour
                chunk['weekday'] = dt_vals.weekday
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

                del chunk
                if chunk_counter % 50 == 0:
                    gc.collect()
                if chunk_counter % 50 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e:
            print(f"❌ Failed to process logon.csv. Error: {e}")

        if logon_total is not None:
            logon_total.index = logon_total.index.astype(str)
            agg_list.append(logon_total)
            print("✅ Successfully processed login events.")

    # --- 2. PROCESS FILES & DECOYS ---
    print("🔍 Processing file access and decoy events from file.csv...")
    if not (RAW_DATA_DIR / "file.csv").exists():
        print("file.csv not found, skipping.")
    else:
        decoy_file_path = RAW_DATA_DIR / "decoy_file.csv"
        if decoy_file_path.exists():
            decoy_df = pd.read_csv(decoy_file_path)
            decoy_set = set(
                decoy_df["decoy_filename"]
                .astype(str)
                .str.strip()
                .str.lower()
            )
            print(f"📄 Decoy file list loaded with {len(decoy_set)} entries.")
        else:
            decoy_df = pd.DataFrame()
            decoy_set = set()
            print("📄 No decoy file list found, proceeding without decoy tracking.")

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
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')

                update_disk_tracking(chunk)

                if 'activity' in chunk.columns:
                    chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else:
                    chunk['activity'] = ''

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

                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e:
            print(f"❌ Failed to process file.csv. Error: {e}")

        if file_total is not None:
            file_total.index = file_total.index.astype(str)
            agg_list.append(file_total)
            print("✅ Successfully processed file access events.")

        if decoy_total is not None:
            decoy_total.index = decoy_total.index.astype(str)
            decoy_series = decoy_total.rename('decoy_access_count')
            agg_list.append(decoy_series.to_frame())
            print("✅ Decoy access events processed.")
        else:
            dummy = pd.Series(0, index=features.index, name='decoy_access_count')
            agg_list.append(dummy.to_frame())
            print("ℹ️ No decoy accesses recorded.")

    # --- 3. PROCESS EMAILS ---
    print("🔍 Processing email events from email.csv...")
    if not (RAW_DATA_DIR / "email.csv").exists():
        print("email.csv not found, skipping.")
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
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')

                update_disk_tracking(chunk)

                chunk['size'] = pd.to_numeric(chunk.get('size', 0), errors='coerce').fillna(0)
                if 'attachments' in chunk.columns:
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

                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception as e:
            print(f"❌ Failed to process email.csv. Error: {e}")

        if email_total is not None:
            email_total.index = email_total.index.astype(str)
            agg_list.append(email_total)
            print("✅ Successfully processed email events.")

    # --- 4. PROCESS DEVICES & SESSIONS ---
    print("🔍 Processing device events from device.csv...")
    if not (RAW_DATA_DIR / "device.csv").exists():
        print("device.csv not found, skipping.")
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
                chunk['user_id'] = chunk['user_id'].astype(str)
                chunk = safe_to_datetime(chunk, 'date')

                update_disk_tracking(chunk, pc_tracking=True, pc_type='device_pc')

                if 'activity' in chunk.columns:
                    chunk['activity'] = chunk['activity'].astype(str).str.lower()
                else:
                    chunk['activity'] = ''

                dt_vals = chunk['date'].dt
                chunk['hour'] = dt_vals.hour if 'date' in chunk.columns else 0
                chunk['weekday'] = dt_vals.weekday if 'date' in chunk.columns else 0
                chunk['is_connect'] = (chunk['activity'] == 'connect').astype(int)
                chunk['is_disconnect'] = (chunk['activity'] == 'disconnect').astype(int)
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

                del chunk
                if chunk_counter % 20 == 0:
                    gc.collect()
                if chunk_counter % 20 == 0:
                    db_conn.execute("PRAGMA wal_checkpoint(PASSIVE)")

            db_conn.commit()

            if device_total is not None:
                device_total.index = device_total.index.astype(str)
                agg_list.append(device_total)
                print("✅ Successfully processed device activity events.")

            if session_total is not None:
                session_total.index = session_total.index.astype(str)
                session_total['avg_session_duration'] = (session_total['dur_sum'] / session_total['dur_cnt']).replace([np.inf, -np.inf], 0).fillna(0)
                agg_list.append(session_total[['avg_session_duration']])
                print("✅ Device session durations calculated.")
            else:
                dummy = pd.Series(0, index=features.index, name='avg_session_duration')
                agg_list.append(dummy.to_frame())
                print("ℹ️ No device sessions recorded.")
        except Exception as e:
            print(f"❌ Failed to process device.csv. Error: {e}")

    flush_sqlite_buffers()

    # --- 5. AGGREGATE LIFETIME ACTIVITY ---
    print("📊 Calculating final behavioral ratios and rolling drift...")

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

    print("🔗 Merging all aggregated features...")
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

    features['activity_per_day'] = (features['total_activity'] / safe_days).round(2)
    features['avg_email_size'] = (features['total_email_size'] / features['email_sent_count'].replace(0, 1)).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    safe_hours = features['total_lifetime_hours'].replace(0, 1)
    features['actions_per_hour'] = (features['total_activity'] / safe_hours).round(2)

    features['connect_disconnect_ratio'] = (features['device_connect_count'] / features['device_disconnect_count'].replace(0, 1)).replace([np.inf, -np.inf], 0).fillna(0).round(2)

    # --- 6. ROLLING WINDOW MATH ---
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
            print("📈 Rolling window and drift features computed.")
    else:
        for col in ['window_7_days', 'window_30_days', 'baseline_90_days', 'drift_7d_vs_30d', 'drift_30d_vs_90d']:
            features[col] = 0
        print("ℹ️ No user activity found for rolling window calculations.")

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

    print(f"✅ Successfully processed {len(final_df)} users. Feature file saved to {FEATURES_FILE}.")

    del features
    gc.collect()
    cleanup_cache()

# ==============================
# 4. Entry Point 
# ==============================
if __name__ == "__main__":
    extract_features()