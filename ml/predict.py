import sys
import joblib
import numpy as np

# ----------------------------
# Load trained model
# ----------------------------
model = joblib.load("uba_model.pkl")

# ----------------------------
# Expected input features (ORDER MATTERS)
# ----------------------------
# login_count,
# unique_pcs,
# active_hours,
# actions_per_hour,
# file_access_count,
# file_copy_count,
# removable_uploads,
# removable_downloads,
# decoy_access_count

EXPECTED_ARGS = 10  # script name + 9 features

if len(sys.argv) != EXPECTED_ARGS:
    print(
        "Usage:\n"
        "python predict.py "
        "login_count unique_pcs active_hours actions_per_hour "
        "file_access_count file_copy_count "
        "removable_uploads removable_downloads "
        "decoy_access_count"
    )
    sys.exit(1)

# ----------------------------
# Parse input arguments
# ----------------------------
login_count = float(sys.argv[1])
unique_pcs = float(sys.argv[2])
active_hours = float(sys.argv[3])
actions_per_hour = float(sys.argv[4])
file_access_count = float(sys.argv[5])
file_copy_count = float(sys.argv[6])
removable_uploads = float(sys.argv[7])
removable_downloads = float(sys.argv[8])
decoy_access_count = float(sys.argv[9])

# ----------------------------
# Prepare input for model
# ----------------------------
sample = np.array([[
    login_count,
    unique_pcs,
    active_hours,
    actions_per_hour,
    file_access_count,
    file_copy_count,
    removable_uploads,
    removable_downloads,
    decoy_access_count
]])

# ----------------------------
# Predict anomaly
# ----------------------------
prediction = model.predict(sample)

if prediction[0] == -1:
    print("Anomaly")
else:
    print("Normal")
