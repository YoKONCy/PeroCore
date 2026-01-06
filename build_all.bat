@echo off
echo ===================================================
echo   PeroFamily Zero-Env Build Pipeline
echo ===================================================

:: 1. Build Frontend
echo [1/4] Building Frontend...
cd /d %~dp0
call npm run build
if %errorlevel% neq 0 (echo Frontend build failed! && pause && exit /b)

:: 2. Build Python Backend (Sidecar)
echo [2/4] Building Python Backend Sidecar...
cd /d %~dp0backend
python build_backend.py
if %errorlevel% neq 0 (echo Backend build failed! && pause && exit /b)

:: 3. Prepare Node.exe (Optional check)
echo [3/4] Checking Portable Node...
if not exist "%~dp0PeroLauncher\src-tauri\bin\node.exe" (
    echo WARNING: node.exe not found in PeroLauncher/src-tauri/bin/
    echo Please place a portable node.exe there for zero-env support.
)

:: 4. Build Tauri App
echo [4/4] Finalizing Tauri Bundle...
cd /d %~dp0PeroLauncher
cargo tauri build
if %errorlevel% neq 0 (echo Tauri build failed! && pause && exit /b)

echo ===================================================
echo   BUILD COMPLETE! Check PeroLauncher/src-tauri/target/release/bundle/
echo ===================================================
pause
