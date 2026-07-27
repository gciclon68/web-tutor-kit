@echo off
cd /d "%~dp0"
echo.
echo   ============================================
echo    Tutor UI  -  bridge local
echo   ============================================
echo.
echo    La primera vez te va a preguntar como hablar
echo    con Claude (CLI logueado o API key).
echo.
echo    Cuando diga "Tutor listo", abri el link que
echo    imprime abajo. Deja esta ventana abierta.
echo.
echo    Para cerrarlo:  Ctrl+C  o cerra la ventana.
echo    Para reconfigurar:  node chat-server.js --reconfigure
echo.
echo   --------------------------------------------
node chat-server.js %*
echo   --------------------------------------------
echo    El server se detuvo o Node no esta instalado / en el PATH.
echo    Hace falta Node.js 18 o mas nuevo:  https://nodejs.org
pause
