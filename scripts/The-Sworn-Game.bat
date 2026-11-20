@echo off
title The Sworn Game
rem Double-click to start the game. Close this window to stop it.
wsl.exe -e bash -lc "$HOME/projects/the-sworn-game/scripts/launch-colony.sh"
if errorlevel 1 pause
