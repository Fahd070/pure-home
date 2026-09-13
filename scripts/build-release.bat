@echo off
setlocal

echo =====================================================================
echo  Pure Home - Build Release Installer
echo  Source: Desktop\WFM-System-Updated
echo  Output: packages\unified-app\dist-installer\
echo  Local build only - no upload, no credentials required
echo =====================================================================
echo.

cd /d "%~dp0.."

:: Check Node is available
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH.
    echo Download from https://nodejs.org and ensure "Add to PATH" is checked.
    pause & exit /b 1
)

:: Install/update root workspace dependencies
echo [1/5] Installing workspace dependencies...
call npm install
if errorlevel 1 (echo ERROR: npm install failed & pause & exit /b 1)

:: Process icons (needed for the installer)
echo.
echo [2/5] Processing application icons...
node scripts\process-icon.js
if errorlevel 1 (
    echo WARNING: Icon processing failed. Continuing with existing icons.
)

:: Install unified-app specific dependencies (includes electron-updater)
echo.
echo [3/5] Installing unified-app dependencies...
cd packages\unified-app
call npm install
if errorlevel 1 (echo ERROR: unified-app npm install failed & cd ..\.. & pause & exit /b 1)
cd ..\..

:: Build the Electron app + create NSIS installer
echo.
echo [4/5] Building unified-app and generating installer...
cd packages\unified-app
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: Build failed. Check TypeScript errors above.
    cd ..\..
    pause & exit /b 1
)
cd ..\..

:: Compile backend (for server deployment package)
echo.
echo [5/5] Compiling backend for production...
cd packages\backend
call npm run build
if errorlevel 1 (
    echo WARNING: Backend compilation failed. Server deployment package may be incomplete.
) else (
    echo Backend compiled successfully.
)
cd ..\..

echo.
echo =====================================================================
echo  BUILD COMPLETE
echo =====================================================================
echo.
echo  This script builds LOCALLY ONLY. It uploads nothing, contacts no
echo  release host, and needs no credentials: no GitHub token, no Vercel
echo  token, no Blob token. electron-builder runs with --publish never.
echo.
echo  Client installer (for employee PCs):
echo    packages\unified-app\dist-installer\Pure-Home-Setup-^<version^>.exe
echo    (^<version^> is the "version" field in packages\unified-app\package.json)
echo.
echo  Installs to: C:\Program Files\Pure Home\
echo  Requires:    Administrator rights (perMachine install)
echo.
echo  NEXT STEPS (all manual):
echo    1. Test the installer on a clean Windows machine
echo    2. Upload the .exe to the installer host, by hand
echo    3. Edit website\release.json: version, releasedAt, installer.name,
echo       installer.url, installer.sizeBytes (exact byte size of the .exe)
echo    4. Deploy the download site, then confirm the page shows the new
echo       version and the Download button fetches the new installer
echo.
echo  There is no auto-update to verify. The desktop app performs no
echo  automatic update check; users update by downloading and running the
echo  installer from the download site.
echo.
echo  Full procedure: docs\RELEASE-DISTRIBUTION.md
echo.
pause
