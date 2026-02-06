import pandas as pd
import os

# ----------------------------
# Paths
# ----------------------------
RAW_DATA_DIR = "data/raw"
PROCESSED_DATA_DIR = "data/processed"

users_file = os.path.join(RAW_DATA_DIR, "users.csv")
logon_file = os.path.join(RAW_DATA_DIR, "logon.csv")
file_file  = os.path.join(RAW_DATA_DIR, "file.csv")
decoy_file = os.path.join(RAW_DATA_DIR, "decoy_file.csv")

# ----------------------------
# Load datasets
# ----------------------------
users_df = pd.read_csv(users_file)
logon_df = pd.read_csv(logon_file)
file_df  = pd.read_csv(file_file)
decoy_df = pd.read_csv(decoy_file)

# ----------------------------
# Normalize column names
# ----------------------------
logon_df.rename(columns={'user': 'user_id'}, inplace=True)
file_df.rename(columns={'user': 'user_id'}, inplace=True)

# ----------------------------
# Safe datetime conversion
# ----------------------------
def safe_to_datetime(df, col):
    if col in df.columns:
        df[col] = pd.to_datetime(df[col], errors="coerce")
    return df

logon_df = safe_to_datetime(logon_df, 'date')
file_df  = safe_to_datetime(file_df, 'date')

# ----------------------------
# MASTER USER LIST (CRITICAL)
# ----------------------------
features = users_df[['user_id']].drop_duplicates()

# =====================================================
# LOGON FEATURES
# =====================================================
logon_features = (
    logon_df
    .groupby('user_id')
    .agg(
        login_count=('activity', lambda x: (x == 'login').sum()),
        unique_pcs=('pc', 'nunique'),
        active_hours=('date', lambda x: x.dt.hour.nunique())
    )
    .reset_index()
)

# Actions per hour (safe division)
logon_features['actions_per_hour'] = (
    logon_features['login_count'] /
    logon_features['active_hours'].replace(0, 1)
)

features = features.merge(logon_features, on='user_id', how='left')

# =====================================================
# FILE FEATURES
# =====================================================
file_features = (
    file_df
    .groupby('user_id')
    .agg(
        file_access_count=('activity', lambda x: (x == 'file_access').sum()),
        file_copy_count=('activity', lambda x: (x == 'copy').sum()),
        removable_uploads=('to_removable_media', 'sum'),
        removable_downloads=('from_removable_media', 'sum')
    )
    .reset_index()
)

features = features.merge(file_features, on='user_id', how='left')

# =====================================================
# DECOY FILE FEATURES
# =====================================================
decoy_access_df = file_df.merge(
    decoy_df,
    left_on=['filename', 'pc'],
    right_on=['decoy_filename', 'pc'],
    how='inner'
)

decoy_features = (
    decoy_access_df
    .groupby('user_id')
    .size()
    .reset_index(name='decoy_access_count')
)

features = features.merge(decoy_features, on='user_id', how='left')

# ----------------------------
# Final cleanup
# ----------------------------
features.fillna(0, inplace=True)
features = features.drop_duplicates(subset=['user_id'])

# ----------------------------
# Save output
# ----------------------------
os.makedirs(PROCESSED_DATA_DIR, exist_ok=True)
output_file = os.path.join(PROCESSED_DATA_DIR, "uba_features.csv")
features.to_csv(output_file, index=False)

print(f"✅ uba_features.csv created with {len(features)} rows (1 per user)")
