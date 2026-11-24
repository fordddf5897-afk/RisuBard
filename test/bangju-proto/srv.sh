#!/bin/bash
# usage: srv.sh <port> <data root> <log>   (re)starts a local test server on that port with that data folder
PORT=$1; ROOT=$2; LOG=$3
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
"$DIR/stop.sh" $PORT || exit 1
cd "$REPO" && (PORT=$PORT RISUBARD_DATA_ROOT=$ROOT nohup node server/node/server.cjs > $LOG 2>&1 &)
for i in $(seq 1 60); do
  if curl -s -o /dev/null http://127.0.0.1:$PORT/api/test_auth; then echo "server up on $PORT"; exit 0; fi
  sleep 0.5
done
echo "server did not start"; tail -20 $LOG; exit 1
