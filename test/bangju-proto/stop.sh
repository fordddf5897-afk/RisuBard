#!/bin/bash
# usage: stop.sh <port> [signal]   stops the local test server on that port and waits until it is gone
PORT=$1; SIG=${2:-TERM}
pids=""
for pid in $(pgrep -f "node server/node/server.cjs"); do
  if tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | grep -qx "PORT=$PORT"; then pids="$pids $pid"; fi
done
for pid in $pids; do kill -$SIG $pid 2>/dev/null; done
for i in $(seq 1 60); do
  alive=0; for pid in $pids; do kill -0 $pid 2>/dev/null && alive=1; done
  [ $alive -eq 0 ] && exit 0
  sleep 0.25
done
echo "still running: $pids"; exit 1
