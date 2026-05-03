# 🛡️ UBA Backend - Data Exfiltration Detection System

The core backend infrastructure for the **Detecting and Preventing Data Exfiltration in Cloud User Behavioral Analytics (UBA)** project.

This backend is designed as a **high-performance, cloud-native system** that detects insider threats and anomalous behavior using **machine learning-based behavioral analysis**.

It follows a **decoupled service-oriented architecture** (microservice-ready design):
- A scalable **Node.js + Express API Gateway** for secure telemetry ingestion and user management
- A Python-based ML service built with FastAPI, designed to run as a standalone service and scalable to an independent microservice for anomaly detection

---

## 📑 Table of Contents

- [1. Project Objective](#-project-objective)
- [2. Key Features](#-key-features)
- [3. Backend Architecture](#-backend-architecture)
- [4. Technologies Used](#-technologies-used)
- [5. Folder Structure](#-folder-structure)
- [6. Environment Setup](#-environment-setup)
- [7. Installation & Usage](#-installation--usage)
- [8. Core API Endpoints](#-core-api-endpoints)
- [9. Machine Learning Details](#-machine-learning-details)
- [10. Deployment Notes](#-deployment-notes)

---

## 🎯 Project Objective

- Build a **scalable log aggregation system** for cloud telemetry
- Detect **insider threats and credential misuse**
- Reduce **false positives using behavioral baselines**
- Provide **real-time alerts and risk scoring**
- Enable **secure and efficient monitoring in cloud environments**

---

## ✨ Key Features

- 🔐 **Advanced Authentication & Security**
  - JWT-based authentication
  - Password hashing using Bcrypt
  - SVG CAPTCHA validation
  - OTP-based email verification

- 🧑‍💼 **Role-Based Access Control (RBAC)**
  - Strict separation between Admin and User routes
  - Middleware-based authorization
  - Dedicated session and log tracking

- ⚡ **Real-Time Monitoring & Alerts**
  - Instant anomaly detection alerts
  - Risk scoring for user actions

- 🚦 **Dynamic Rate Limiting**
  - Redis-based rate limiting
  - Automatic fallback to in-memory store

- 📱 **Device & Session Management**
  - Tracks IP address, device info, and location
  - Allows remote session termination

- ☁️ **Cloud Media Storage**
  - Cloudinary integration for avatar uploads

- 🤖 **Machine Learning Integration**
  - Isolation Forest algorithm
  - Role-based anomaly detection models
  - Handles high-dimensional cloud telemetry

---

## 🏗️ Backend Architecture

The system follows a **decoupled service-oriented architecture**:

### 🔹 Node.js Backend (API Gateway)
- Handles authentication, routing, and API requests
- Performs secure telemetry ingestion
- Communicates with the ML service via REST APIs
- Stores logs in MongoDB

### 🔹 Python ML Service (FastAPI)
- Performs feature engineering
- Generates behavioral baselines
- Calculates anomaly scores
- Returns risk predictions

### 🔹 Data Flow

1. User activity → API Gateway  
2. Data stored in MongoDB  
3. Features are extracted and processed by the ML service  
4. ML model evaluates anomaly  
5. Risk score returned  
6. Alert generated (if needed)

---

## 🛠️ Technologies Used

### 🔹 Backend (Node.js)
- Node.js & Express.js
- MongoDB & Mongoose
- Socket.io
- Helmet & Express Rate Limit
- Redis (optional)
- CORS
- Multer & Cloudinary
- Nodemailer
- Compression & UAParser

### 🔹 Machine Learning (Python)
- Python 3.11
- Scikit-Learn
- Pandas
- NumPy
- Isolation Forest Algorithm
- Pickle (.pkl) model storage

---

## 📂 Folder Structure
```text
UBA-BACKEND/
├── api/                   # Server entry point (index.js)
├── config/                # Database and third-party configuration
├── controllers/           # Route logic (Auth, Admin, UBA, Settings)
├── middleware/            # Auth guards, Rate limiters, Multer uploads
├── ml/                    # Machine Learning module (FastAPI + offline processing)
│   ├── data/              # Raw and processed CSV datasets
│   ├── models/            # Compiled .pkl models for role-based detection
│   ├── create_features.py # Feature engineering scripts
│   ├── uba_server.py      # Local Python API for model predictions
│   └── requirements.txt   # Python dependencies
├── models/                # Mongoose DB Schemas (User, Admin, Logs, Alerts)
├── routes/                # Express API route definitions
├── scripts/               # Database seeding and utility scripts
├── utils/                 # Loggers, Email Templates, ML Health Checks
├── .env.example           # Environment variable template
└── package.json           # Node dependencies and scripts
```
---

## ⚙️ Environment Setup

Create a `.env` file in the root directory and add:

```env
# Server
PORT=5000
ALLOWED_ORIGINS=http://localhost:5173

# Database
MONGO_URI=your_mongodb_connection_string

# Authentication
JWT_SECRET=your_jwt_secret
CAPTCHA_SECRET=your_captcha_secret

# Email (Nodemailer)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Rate Limiting
USE_REDIS=false
REDIS_URL=redis://localhost:6379
```
---

## 🚀 Installation & Usage
Due to the hybrid nature of this backend, the Node.js API and the Python ML module are initialized separately.

### 1. Starting the Node.js API
This boots up the core REST API and Socket.io server.

```bash
# Install Node dependencies
npm install

# Start the server in development mode (using nodemon)
npm run dev

# Or start in production mode
npm start
```

---
### 2. Starting the ML Python Server (Local Processing)
The ML module is designed to run locally to process heavy CSV files without bloating cloud servers.

```bash
# Navigate to the ML directory
cd ml

# Install Python dependencies
pip install -r requirements.txt

# Start the local ML prediction server
python uba_server.py
```

---

## 📡 Core API Endpoints
A brief overview of the primary route structures:

- `/api/v1/auth` - Registration, Login, CAPTCHA, Password Resets, and OTP handling.
- `/api/v1/user` - Dashboard statistics, recent activity, and standard user operations.
- `/api/v1/admin` - System-wide logs, user management, and access control.
- `/api/v1/uba` - Anomaly reviews, alert fetching, and ML prediction ingestion.
- `/api/v1/settings` - Profile updates, avatar uploads, and active session management.

---

## 🧠 Machine Learning Details
- Uses Isolation Forest algorithm
- Handles high-dimensional cloud data
- Works without labeled datasets (unsupervised)
- Detects:
  - Unusual login times
  - Suspicious locations
  - Abnormal data transfers
  - Insider threat behavior

---
## ☁️ Deployment Notes

This backend is designed for cloud deployment using platforms such as **Render** or **Railway**.

### 🔹 Node.js API
- Can be deployed as a public backend service
- Handles authentication, APIs, and real-time communication
- Connects to MongoDB Atlas or any cloud database

### 🔹 Machine Learning Service
- Can run in two modes:
  - As a **local processing module** for batch data analysis
  - As a **FastAPI-based service** (using Uvicorn) for real-time predictions
  - ML service can be deployed separately as an independent microservice for scalable production environments
