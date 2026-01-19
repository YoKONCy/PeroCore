@echo off
title NapCat Console
echo [INFO] NapCat Launcher Wrapper
echo [INFO] QQ Path: "C:\Softwares\QQ\QQ.exe"
echo [INFO] Starting...
"node.exe" index.js
if %errorlevel% neq 0 echo [ERROR] Process exited with code %errorlevel%
echo [INFO] Process exited.
pause
