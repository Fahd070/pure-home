@echo off
echo =============================================
echo  WFM - Water Filter Maintenance Setup
echo =============================================
cd /d "%~dp0.."

echo [1/4] Installing dependencies...
call npm install
if errorlevel 1 (echo ERROR: npm install failed & pause & exit /b 1)

echo [2/4] Generating Prisma client...
cd packages\backend
call ..\..\node_modules\.bin\prisma generate --schema=prisma\schema.prisma
if errorlevel 1 (echo ERROR: prisma generate failed & pause & exit /b 1)

echo [3/4] Running database migrations...
call ..\..\node_modules\.bin\prisma migrate deploy --schema=prisma\schema.prisma
if errorlevel 1 (
  echo Trying migrate dev instead...
  call ..\..\node_modules\.bin\prisma migrate dev --name init --schema=prisma\schema.prisma
)

echo [4/4] Seeding database...
call ..\..\node_modules\.bin\ts-node prisma\seed.ts
if errorlevel 1 (
  echo Trying tsx seed...
  call ..\..\node_modules\.bin\tsx prisma\seed.ts
)

cd ..\..
echo.
echo =============================================
echo  Setup complete!
echo  Credentials:
echo    admin@wfm.local / admin123
echo    scheduling@wfm.local / sched123
echo    tech1@wfm.local / tech123
echo =============================================
pause
