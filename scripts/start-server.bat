@echo off
echo Starting WFM Backend Server...
cd /d "%~dp0..\packages\backend"
..\..\node_modules\.bin\ts-node-dev --respawn --transpile-only src\index.ts
pause
