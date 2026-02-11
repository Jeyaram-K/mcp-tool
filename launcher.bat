@echo off
title App Launcher
echo ==========================
echo     Starting Application
echo ==========================

REM Go to script folder
cd /d "%~dp0"

REM Run the program
npm start

echo.
echo ==========================
echo     Program Finished
echo ==========================
pause
