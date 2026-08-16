@echo off
echo ==============================================================
echo RetailBrain IBM - Project Launcher (Global Python)
echo ==============================================================
echo.
echo [1/3] Verifying and Installing Python Dependencies...
python -m pip install pandas numpy lightgbm scikit-learn joblib fastapi python-multipart uvicorn openpyxl
echo.
echo [2/3] Executing AI Sourcing & Demand Forecasting Pipeline...
python run_pipeline.py
echo.
echo [3/3] Launching FastAPI Dashboard Server on http://127.0.0.1:8000...
start "" http://127.0.0.1:8000
python main.py
pause
