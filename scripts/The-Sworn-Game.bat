@echo off
title The Sworn Game
rem Double-click to start the game. Close this window to stop it.
wsl.exe -e bash -lc "$HOME/projects/colony2d/scripts/launch-colony.sh"
if errorlevel 1 pause
