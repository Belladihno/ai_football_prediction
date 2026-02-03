@echo off
REM Football Prediction ML - Environment Setup Script
REM This script creates a Python 3.12 virtual environment and installs dependencies

echo ============================================
echo Football Prediction ML - Setup Script
echo ============================================
echo.

REM Check if Python 3.12 is available
echo Checking for Python 3.12...
py -3.12 --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python 3.12 is not installed!
    echo.
    echo Please download Python 3.12 from:
    echo   https://www.python.org/downloads/release/python-3129/
    echo.
    echo After installing, run this script again.
    pause
    exit /b 1
)

py -3.12 --version

REM Create virtual environment
echo.
echo Creating virtual environment...
if exist ml_venv (
    echo Removing existing ml_venv...
    rmdir /s /q ml_venv
)

py -3.12 -m venv ml_venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment!
    pause
    exit /b 1
)

echo Virtual environment created successfully!

REM Activate and install dependencies
echo.
echo Activating virtual environment and installing dependencies...
call ml_venv\Scripts\activate.bat

echo Upgrading pip...
python -m pip install --upgrade pip

echo.
echo Installing ML dependencies...
pip install -r requirements.txt

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo ============================================
echo Setup Complete!
echo ============================================
echo.
echo To activate the environment, run:
echo   ml_venv\Scripts\activate
echo.
echo To run training:
echo   cd training
echo   python train.py
echo.
pause
