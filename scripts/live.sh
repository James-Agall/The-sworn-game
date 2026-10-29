#!/usr/bin/env bash
# The "always-on" copy of The Sworn Game: runs from a frozen snapshot, so editing code in the repo (or
# agents restarting dev servers / running builds) never touches it. The game keeps running in the
# background after this window closes. Same ports as dev (server :8080, client :5173) and the same saves
# (server/saves), so only one of the live copy and `npm run dev` can run at a time.
#
# The snapshot is server/src + shared/ (the @colony/shared package both sides import) + a built client.
#
#   live.sh            start (snapshots the current code first; just opens the browser if already running)
#   live.sh update     stop, take a fresh snapshot of the code, start again (your world is autosaved/restored)
#   live.sh stop       stop it
#   live.sh status     show whether it is running
#   live.sh logs       follow the server log
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LIVE="${COLONY_LIVE_DIR:-$HOME/colony2d-live}"
SAVES="${COLONY_SAVE_DIR:-$REPO/server/saves}"
SP="${COLONY_LIVE_SERVER_PORT:-8080}"   # the client is built to talk to :8080; only change these to test the script
CP="${COLONY_LIVE_CLIENT_PORT:-5173}"
URL="http://localhost:$CP"
PIDS="$LIVE/pids"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

listening() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
alive() { [ -f "$PIDS/$1" ] && kill -0 "$(cat "$PIDS/$1")" 2>/dev/null; }
running() { alive server && alive client; }

open_browser() {
  for _ in $(seq 1 30); do listening "$CP" && break; sleep 1; done
  if command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "Open $URL in your browser."; fi
}

stop_one() { # kill the whole process group so tsx's child dies too
  alive "$1" || { rm -f "$PIDS/$1"; return 0; }
  local pid; pid="$(cat "$PIDS/$1")"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  kill -KILL -- "-$pid" 2>/dev/null
  rm -f "$PIDS/$1"
}
stop_all() { stop_one client; stop_one server; }

snapshot() {
  echo "Snapshotting the code into $LIVE ..."
  mkdir -p "$LIVE/server" "$LIVE/client" "$PIDS" "$SAVES"
  rm -rf "$LIVE/server/src" "$LIVE/client/dist" "$LIVE/shared"
  cp -r "$REPO/server/src" "$LIVE/server/src"
  cp "$REPO/server/package.json" "$LIVE/server/package.json"
  cp -r "$REPO/shared" "$LIVE/shared"
  # node_modules: a dir of symlinks into the repo's, except @colony/shared (in the repo a workspace link to
  # repo/shared), which points at the snapshot's own shared/ so the live server never runs repo edits.
  # (rm -rf on a symlink or a dir of symlinks never touches what they point at.)
  rm -rf "$LIVE/node_modules"
  mkdir -p "$LIVE/node_modules/@colony"
  for m in "$REPO"/node_modules/* "$REPO"/node_modules/.[!.]*; do
    [ -e "$m" ] || continue
    case "$(basename "$m")" in @colony) continue ;; esac
    ln -s "$m" "$LIVE/node_modules/$(basename "$m")"
  done
  ln -s ../../shared "$LIVE/node_modules/@colony/shared"
  (cd "$REPO/client" && npx vite build --outDir "$LIVE/client/dist" --emptyOutDir) >"$LIVE/build.log" 2>&1 \
    || { echo "Client build failed, see $LIVE/build.log"; tail -15 "$LIVE/build.log"; return 1; }
}

start() {
  if running; then echo "The Sworn Game (live) is already running."; open_browser; return 0; fi
  stop_all
  if listening "$SP" || listening "$CP"; then
    echo "Port $SP or $CP is already taken (probably 'npm run dev' or launch-colony.sh)."
    echo "Close that copy first, then run this again."
    return 1
  fi
  snapshot || return 1
  # setsid: its own session, so it survives this terminal closing and nothing here can signal it by accident.
  PORT="$SP" COLONY_SAVE_DIR="$SAVES" setsid nohup "$LIVE/node_modules/.bin/tsx" "$LIVE/server/src/index.ts" \
    >"$LIVE/server.log" 2>&1 </dev/null &
  echo $! >"$PIDS/server"
  setsid nohup python3 -m http.server "$CP" --bind 0.0.0.0 --directory "$LIVE/client/dist" \
    >"$LIVE/client.log" 2>&1 </dev/null &
  echo $! >"$PIDS/client"
  for _ in $(seq 1 30); do listening "$SP" && listening "$CP" && break; sleep 1; done
  if running && listening "$SP"; then
    echo "Running in the background. Code edits no longer affect it; run 'live.sh update' to pick them up."
    open_browser
  else
    echo "It did not start, see $LIVE/server.log"; tail -15 "$LIVE/server.log"; stop_all; return 1
  fi
}

case "${1:-start}" in
  start) start ;;
  update|restart) stop_all; start ;;
  stop) stop_all; echo "Stopped." ;;
  status) if running; then echo "running (server pid $(cat "$PIDS/server"), client pid $(cat "$PIDS/client"))"; else echo "not running"; fi ;;
  logs) tail -f "$LIVE/server.log" ;;
  *) echo "usage: $0 [start|update|stop|status|logs]"; exit 2 ;;
esac
