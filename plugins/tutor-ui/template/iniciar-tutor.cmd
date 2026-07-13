@echo off
cd /d "%~dp0"
echo.
echo   ============================================
echo    Tutor UI  -  bridge local (Claude Code)
echo   ============================================
echo.
echo    Cuando aparezca "bridge activo", abri en el navegador:
echo.
echo        http://localhost:8770
echo.
echo    Deja esta ventana abierta mientras uses el tutor.
echo    Para cerrarlo:  Ctrl+C  o cerra la ventana.
echo.
echo   --------------------------------------------
node chat-server.js
echo   --------------------------------------------
echo    El server se detuvo o Node no esta instalado / en el PATH.
pause
