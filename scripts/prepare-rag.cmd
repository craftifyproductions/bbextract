@echo off
setlocal
REM Run from any model folder: prepare-rag   or   prepare-rag --force
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%prepare-rag-folder.mjs" %*
