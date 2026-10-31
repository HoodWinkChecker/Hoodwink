@echo off
cd /d "%~dp0"
title HOODWINK - deploiement
echo Deploiement complet de Hoodwink (site + fonctions serveur) sur Netlify
echo.
call npm install --silent
if not exist ".netlify\state.json" (
  echo Premiere fois: connexion a Netlify puis choix du site hoodwink.site
  call npx --yes netlify-cli login
  call npx --yes netlify-cli link
)
call npx --yes netlify-cli deploy --prod
echo.
echo Termine. Verifie: https://hoodwink.site/api/tickers-tail?shard=RE
pause
