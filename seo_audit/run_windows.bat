@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo === Website Lighthouse Audit Tool - Windows launcher ===
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python was not found on PATH. Install Python 3.11+ from https://www.python.org/downloads/
    echo         and make sure "Add python.exe to PATH" is checked during install.
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [setup] Creating virtual environment in .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        exit /b 1
    )
)

echo [setup] Installing/verifying Python dependencies ...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Dependency installation failed. See output above for details.
    exit /b 1
)

if not exist ".env" (
    echo [setup] No .env found, copying from .env.example
    copy /y .env.example .env >nul
)

where node >nul 2>nul
if errorlevel 1 (
    echo [warn] Node.js was not found on PATH. The local Lighthouse CLI engine
    echo        will be unavailable; the PageSpeed Insights engine still works
    echo        if PAGESPEED_API_KEY is set in .env.
) else (
    where lighthouse >nul 2>nul
    if errorlevel 1 (
        echo [warn] The 'lighthouse' npm package was not found. Install it with:
        echo            npm install -g lighthouse
        echo        to enable the local Lighthouse CLI engine.
    ) else (
        echo [ok] Node.js and Lighthouse CLI detected.
    )
)

echo.
echo [run] Starting FastAPI server at http://127.0.0.1:8000
echo       Press Ctrl+C to stop.
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
