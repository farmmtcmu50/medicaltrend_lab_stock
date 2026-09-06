@echo off
cd /d "%~dp0"
echo Creating Cloudflare D1 database: medical-trend-lab-stock
npx wrangler d1 create medical-trend-lab-stock
echo.
echo Copy the database_id shown above.
echo Open wrangler.jsonc and replace REPLACE_WITH_D1_DATABASE_ID with that database_id.
echo Then run 04_migrate_and_deploy.bat
pause
