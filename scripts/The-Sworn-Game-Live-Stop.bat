@echo off
title Stop The Sworn Game (live)
wsl.exe -e bash -lc "$HOME/projects/the-sworn-game/scripts/live.sh stop"
pause
