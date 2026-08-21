@echo off
REM Set up and start Claude Pet on Windows.
REM Double-click this file, or run it from a terminal in this folder.

cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
    echo Python was not found.
    echo Install it from https://www.python.org/downloads/ and tick
    echo "Add python.exe to PATH" during setup, then run this again.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating a private environment for Claude Pet...
    py -3 -m venv .venv || goto :failed
    echo Installing dependencies, this takes a minute...
    ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :failed
    REM Optional: music detection. Never let this break the install.
    ".venv\Scripts\python.exe" -m pip install winsdk >nul 2>nul
)

echo Starting Claude Pet. Close it from the tray icon.
start "" ".venv\Scripts\pythonw.exe" claude_pet.py
exit /b 0

:failed
echo.
echo Setup failed. Please copy the output above when reporting it.
pause
exit /b 1
