@echo off
cd /d "%~dp0"
echo Exporting current portable SQLite data to D1 import SQL...
python migrate_sqlite_to_d1.py
echo.
echo Importing into Cloudflare D1 remote database...
npx wrangler d1 execute medical-trend-lab-stock --remote --file=./d1_import_from_portable.sql
pause
