@echo off
title The Sworn Game (live)
rem Double-click to start the always-on copy. It keeps running in the background after this window closes,
rem even while the code is being edited. Run "live.sh stop" in WSL (or the Stop .bat) to end it.
wsl.exe -e bash -lc "$HOME/projects/colony2d/scripts/live.sh start"
if errorlevel 1 pause
