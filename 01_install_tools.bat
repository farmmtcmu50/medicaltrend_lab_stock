@echo off
cd /d "%~dp0"
echo Installing Cloudflare app dependencies...
npm install
echo.
echo Done. Next run 02_login_cloudflare.bat
pause
