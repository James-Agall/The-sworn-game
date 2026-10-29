@echo off
title Stop The Sworn Game (live)
wsl.exe -e bash -lc "$HOME/projects/colony2d/scripts/live.sh stop"
pause
