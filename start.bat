@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Zainstaluj Node.js: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\vite (
  echo Pierwsze uruchomienie: instaluje aplikacje...
  call npm install
  if errorlevel 1 (
    echo Instalacja nie wyszla.
    pause
    exit /b 1
  )
)
call npm run dev
