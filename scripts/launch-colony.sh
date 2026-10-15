#!/usr/bin/env bash
# Starts the colony2d server (:8080) and client (:5173) and opens the game in the browser.
# Runs in the foreground so the window that launched it IS the game: close it (or Ctrl+C) to stop.
# If the game is already running it just opens the browser.
set -u
cd "$(dirname "$0")/.."

# Node comes from nvm on this machine; a non-interactive shell doesn't load it.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

URL="http://localhost:5173"
listening() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

open_browser() {
  # Wait for the client dev server, then open the default Windows browser (falls back to xdg-open).
  for _ in $(seq 1 60); do
    listening 5173 && break
    sleep 1
  done
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$URL" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1
  else
    echo "Open $URL in your browser."
  fi
}

if listening 8080 && listening 5173; then
  echo "The Sworn Game is already running."
  open_browser
  exit 0
fi

if listening 8080 || listening 5173; then
  echo "One of the game's ports (8080 server, 5173 client) is already in use by something else."
  echo "Close it (or the other copy of the game) and try again."
  read -r -p "Press Enter to close... " _
  exit 1
fi

[ -d node_modules ] || { echo "Installing dependencies (first run)..."; npm install; }

echo "Starting The Sworn Game... close this window to stop it."
open_browser &
exec npm run dev
