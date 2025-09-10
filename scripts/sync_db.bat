@echo off
echo Starting database sync from production...

echo Creating backup of current dev database...
"C:\Program Files\MySQL\MySQL Server 9.1\bin\mysqldump.exe" -u root -p gbrfl > dev_backup_before_sync_%date:~-4,4%%date:~-10,2%%date:~-7,2%.sql

echo Exporting production database...
"C:\Program Files\MySQL\MySQL Server 9.1\bin\mysqldump.exe" -h caboose.proxy.rlwy.net -P 59613 -u root -pJZjKXAUlauvUwThojErTNcsjYOIhOMDa --single-transaction --routines --triggers railway > temp_production_export.sql

echo Replacing local dev database...
"C:\Program Files\MySQL\MySQL Server 9.1\bin\mysql.exe" -u root -p -e "DROP DATABASE IF EXISTS gbrfl;"
"C:\Program Files\MySQL\MySQL Server 9.1\bin\mysql.exe" -u root -p -e "CREATE DATABASE gbrfl;"
"C:\Program Files\MySQL\MySQL Server 9.1\bin\mysql.exe" -u root -p gbrfl < temp_production_export.sql

echo Cleaning up temporary files...
del temp_production_export.sql

echo Database sync completed! Your local gbrfl is now synced with production.
pause