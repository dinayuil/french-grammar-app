@echo off
setlocal
node "%~dp0scripts\build-apk.mjs" %*
exit /b %ERRORLEVEL%
