@echo off
echo =============================================
echo  WFM - Building All Installers
echo =============================================
cd /d "%~dp0.."

echo [1/3] Processing icons...
node scripts\process-icon.js

echo [2/3] Building Admin app...
cd packages\admin-app
call npm run build
cd ..\..

echo [3/3] Building Scheduling app...
cd packages\scheduling-app
call npm run build
cd ..\..

echo [4/4] Building Technician app...
cd packages\technician-app
call npm run build
cd ..\..

echo.
echo =============================================
echo  Build complete! Check dist-installer/ in each app folder.
echo =============================================
pause
