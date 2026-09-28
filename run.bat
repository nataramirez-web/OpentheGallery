@echo off
title Servidor Multijugador Laberinto
echo =======================================
echo    Iniciando Servidor Node.js
echo =======================================
echo.
echo Levantando el servidor...
echo.
start http://localhost:3000
node server.js

echo.
echo =======================================
echo ERROR: El servidor se ha detenido. 
echo Asegurate de haber ejecutado install.bat primero.
echo =======================================
pause

