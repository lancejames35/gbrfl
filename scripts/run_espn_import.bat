@echo off
echo Starting nightly ESPN player import...
cd /d "C:\Users\lance\OneDrive\LANCE\GBRFL\web\scripts"
python importEspnPlayersEnhanced.py > espn_import_log_%date:~-4,4%%date:~-10,2%%date:~-7,2%.txt 2>&1
echo ESPN import completed at %date% %time%