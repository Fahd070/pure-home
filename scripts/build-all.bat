@echo off
echo =============================================
echo  WFM - Building All Installers
echo =============================================
cd /d "%~dp0.."

echo [1/4] Processing icons...
node scripts\process-icon.js

echo [2/4] Building Unified App (main installer)...
cd packages\unified-app
call npm install
call npm run build
if errorlevel 1 (
    echo ERROR: Unified app build failed.
    cd ..\..
    pause & exit /b 1
)
cd ..\..

echo [3/4] Compiling backend...
cd packages\backend
call npm run build
cd ..\..

echo [4/4] Done.
echo.
echo =============================================
echo  Build complete!
echo  Installer: packages\unified-app\dist-installer\
echo  Installs to: C:\Program Files\Pure Home\
echo =============================================
pause
