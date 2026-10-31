@echo off
cd /d "%~dp0"
set NODE_NO_WARNINGS=1
title HOODWINK
echo HOODWINK - site local http://localhost:6912
start "" http://localhost:6912
node serve.mjs 6912
pause
