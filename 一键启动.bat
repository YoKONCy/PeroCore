@echo off
:: ============================================================
:: Pero Launcher - Auto Environment Setup
:: ============================================================
:: This script is written in standard ANSI/UTF-8 for CMD compatibility.
:: ============================================================

setlocal enabledelayedexpansion

:: Force code page to 437 (US English) for best compatibility with taskkill/netstat output parsing
chcp 437 >nul

title Pero Launcher - Dev Mode

:: Define paths
set "PERO_DIR=%~dp0"
set "TOOLS_DIR=%PERO_DIR%backend\nit_core\tools"
set "ES_EXE=%TOOLS_DIR%\core\FileSearch\es.exe"

:: es.exe Download Mirrors
set "URL1=https://www.voidtools.com/ES-1.1.0.30.x64.zip"
set "URL2=https://github.com/voidtools/ES/releases/download/1.1.0.30/ES-1.1.0.30.x64.zip"
set "URL3=https://fastly.jsdelivr.net/gh/voidtools/ES@1.1.0.30/ES-1.1.0.30.x64.zip"

set "TEMP_ZIP=%TEMP%\es_cli.zip"
set "TEMP_DIR=%TEMP%\es_cli_extracted"

echo ============================================================
echo           Pero Launcher - Environment Setup
echo ============================================================
echo.

:: 0. Cleanup and Base Check
echo [0/3] Cleaning up old processes...

:: Kill python, electron and PeroCore
taskkill /f /im python.exe /t >nul 2>&1
taskkill /f /im electron.exe /t >nul 2>&1
taskkill /f /im PeroCore.exe /t >nul 2>&1

:: Specifically check and kill port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [i] Killing process %%a using port 3000...
    taskkill /f /pid %%a >nul 2>&1
)

:: Check required tools
echo [i] Checking core environments...

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo [GUIDE] Please download and install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)

:: Check npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    echo [GUIDE] npm usually comes with Node.js. Please reinstall Node.js.
    pause
    exit /b 1
)

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo [GUIDE] Please install Python 3.10+ from: https://www.python.org/downloads/
    echo [GUIDE] Ensure "Add Python to PATH" is checked during installation.
    pause
    exit /b 1
)

:: Check curl
where curl >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] curl is not installed or not in PATH.
    echo [GUIDE] curl is usually built-in on Windows 10/11. If missing, please update Windows or install curl manually.
    pause
    exit /b 1
)
echo [OK] Base environment ready.

:: 1. Check es.exe
echo.
echo [1/3] Checking Everything CLI (es.exe)...

if exist "%ES_EXE%" (
    echo [OK] es.exe found.
) else (
    echo [!] es.exe missing. Downloading...
    if not exist "%TOOLS_DIR%\core\FileSearch" mkdir "%TOOLS_DIR%\core\FileSearch"
    
    set "DOWNLOADED=false"
    for %%u in ("%URL1%" "%URL2%" "%URL3%") do (
        if "!DOWNLOADED!"=="false" (
            echo [i] Trying: %%~u
            curl -L -f --connect-timeout 10 "%%~u" -o "%TEMP_ZIP%"
            if !errorlevel! equ 0 (
                set "DOWNLOADED=true"
                echo [OK] Download successful.
            )
        )
    )
    
    if "!DOWNLOADED!"=="false" (
        echo [ERROR] Failed to download es.exe. Please install it manually.
        pause
        exit /b 1
    )
    
    echo [i] Extracting...
    if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%"
    powershell -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TEMP_DIR%' -Force"
    
    if exist "%TEMP_DIR%\es.exe" (
        if not exist "%TOOLS_DIR%\FileSearch" mkdir "%TOOLS_DIR%\FileSearch"
        move /y "%TEMP_DIR%\es.exe" "%ES_EXE%" >nul
        echo [OK] es.exe installed to tools\FileSearch directory.
    ) else (
        echo [ERROR] Extraction failed.
        pause
        exit /b 1
    )
    
    del "%TEMP_ZIP%" >nul 2>&1
    rd /s /q "%TEMP_DIR%" >nul 2>&1
)

:: 2. Check Dependencies
echo.
echo [2/3] Checking dependencies...

:: Node dependencies
echo [i] Checking Node.js dependencies...
if not exist "%PERO_DIR%node_modules" (
    echo [!] node_modules missing. Running npm install...
    cd /d "%PERO_DIR%"
    call npm install
) else (
    echo [OK] node_modules found.
)

:: Python dependencies
echo [i] Checking Python dependencies...
if exist "backend\requirements.txt" (
    echo [!] Installing/Updating Python packages...
    python -m pip install --upgrade pip >nul 2>&1
    python -m pip install -r backend\requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install Python dependencies.
        echo [GUIDE] Try running 'pip install -r backend\requirements.txt' manually.
        pause
        exit /b 1
    )
    echo [OK] Python dependencies ready.
) else (
    echo [!] backend\requirements.txt not found, skipping Python package check.
)

:: 3. Start PeroCore
echo.
echo [3/3] Launching PeroCore...
cd /d "%PERO_DIR%"

:: Double check backend existence
if not exist "backend\main.py" (
    echo [ERROR] backend\main.py not found.
    pause
    exit /b 1
)

:: Use PowerShell to start the dev server completely hidden in the background.
:: We use powershell.exe -Command to avoid Windows trying to open it as a script file.
echo [i] Starting PeroCore in background...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c npm run electron:dev' -WindowStyle Hidden"

echo.
echo [i] Waiting for PeroCore to initialize (port 3000)...
echo [i] This window will close automatically on success.

set "retry=0"
:LOOP
set /a retry+=1
if %retry% gtr 60 (
    echo.
    echo [ERROR] Startup timed out. 
    echo [i] If the app didn't start, try running 'npm run electron:dev' manually to see errors.
    pause
    exit /b 1
)

:: Check if 8000 is listening
netstat -ano | findstr :3000 | findstr LISTENING >nul
if %errorlevel% neq 0 (
    <nul set /p =.
    timeout /t 2 >nul
    goto LOOP
)

echo.
echo [OK] PeroCore is ready!
echo [OK] Closing launcher...
timeout /t 2 >nul
exit
