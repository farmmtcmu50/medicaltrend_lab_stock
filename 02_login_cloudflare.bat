@echo off
cd /d "%~dp0"
echo This will open a browser for Cloudflare login.
npx wrangler login
echo.
echo Done. Next run 03_create_d1_database.bat
pause
