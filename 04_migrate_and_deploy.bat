@echo off
cd /d "%~dp0"
findstr /C:"REPLACE_WITH_D1_DATABASE_ID" wrangler.jsonc >nul
if %errorlevel%==0 (
  echo Please edit wrangler.jsonc first and replace REPLACE_WITH_D1_DATABASE_ID with your real database_id.
  pause
  exit /b 1
)
echo Applying D1 migrations...
npx wrangler d1 migrations apply medical-trend-lab-stock --remote
echo.
echo Set SESSION_SECRET if you have not done it before.
npx wrangler secret put SESSION_SECRET
echo.
echo Deploying to stock.medicaltrend.stream...
npx wrangler deploy
pause
