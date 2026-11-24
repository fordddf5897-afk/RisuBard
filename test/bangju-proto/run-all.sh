#!/bin/bash
# 방주 전체 자동 점검: 지금까지 만든 방주 기능의 검사와 앱의 서버 테스트를 처음부터 끝까지 돌린다.
#   ./run-all.sh            보통 점검
#   ./run-all.sh --scale    큰 가짜 자료(봇 1,150개)로 하는 점검까지 (메모리 5GB쯤 필요, 몇 분 더 걸림)
#   ./run-all.sh --no-app   앱의 서버 테스트는 건너뛴다
# 새 기능을 만들면 그 검사를 여기에 더한다. 하나라도 실패하면 실패로 끝난다.
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
WORK="$(mktemp -d /tmp/bangju-check.XXXXXX)"
SCALE=0; APP=1
for arg in "$@"; do [ "$arg" = "--scale" ] && SCALE=1; [ "$arg" = "--no-app" ] && APP=0; done
PORT=7900; PASSED=0; FAILED=0; SKIPPED=0; SUMMARY=""
cd "$DIR" || exit 1

# start <env assignments...> : a fresh server with an empty data folder on the next port
start() {
  PORT=$((PORT + 1)); ROOT="$WORK/data-$PORT"; LOG="$WORK/server-$PORT.log"; BASE="http://127.0.0.1:$PORT"
  env "$@" ./srv.sh $PORT "$ROOT" "$LOG" > /dev/null || { echo "server did not start (port $PORT)"; tail -20 "$LOG"; return 1; }
}
finish() { ./stop.sh $PORT > /dev/null 2>&1; }
# check <label> <command...> : runs one script, counts its PASS / FAIL lines
check() {
  local label="$1"; shift
  local out; out="$("$@" 2>&1)"; local code=$?
  local pass fail; pass=$(grep -c '^PASS' <<< "$out"); fail=$(grep -c '^FAIL' <<< "$out")
  if [ $code -ne 0 ] || [ "$fail" -gt 0 ] || grep -q 'TEST CRASHED\|FAILED' <<< "$out"; then
    FAILED=$((FAILED + 1)); SUMMARY="$SUMMARY\n  실패  $label ($pass 통과, $fail 실패)"
    echo "=== $label: 실패"; grep -v '^PASS' <<< "$out" | head -30
  else
    PASSED=$((PASSED + 1)); SUMMARY="$SUMMARY\n  통과  $label ($pass)"
    echo "=== $label: 통과 ($pass)"
  fi
}
seeded() { node seed2.cjs "$BASE" 12 > /dev/null 2>&1; }

check "t10 그림 찾기(모듈)" node t10.cjs

for t in t1 t2 t3 t8 t12; do
  case $t in t1) label="t1 보관·불러오기 핵심";; t2) label="t2 V3 폴더 봇";; t3) label="t3 그림 보호 두 겹";; t8) label="t8 마지막 결과 남기기";; t12) label="t12 목록 정보와 표지";; esac
  start BANGJU_ARCHIVE_SETTLE=now && seeded && check "$label" node $t.cjs "$BASE" "$ROOT"; finish
done
start BANGJU_ARCHIVE_SETTLE=now && seeded && check "t4 중단 복구와 이어서 하기" env BANGJU_ARCHIVE_SETTLE=now node t4.cjs "$BASE" "$ROOT" $PORT "$LOG"; finish
start BANGJU_ARCHIVE_SETTLE=now BANGJU_ARCHIVE_TEST_FAIL_RELOAD=1 && seeded && check "t7 정리 실패 때 되돌리기(바로 정리)" node t7.cjs "$BASE" "$ROOT"; finish
start BANGJU_ARCHIVE_SETTLE_DELAY_MS=2000 && seeded && check "t9 기본 방식(나중에 정리)" node t9.cjs "$BASE" "$ROOT"; finish
start BANGJU_ARCHIVE_SETTLE_DELAY_MS=1500 BANGJU_ARCHIVE_TEST_FAIL_RELOAD=1 && seeded && check "t9 정리 실패 때 되돌리기(기본 방식)" node t9.cjs "$BASE" "$ROOT" rollback; finish

# backup: two servers, the second one empty
start BANGJU_ARCHIVE_SETTLE=now && seeded; P1=$PORT; R1=$ROOT; L1=$LOG; B1=$BASE
start BANGJU_ARCHIVE_SETTLE=now
check "t13 자리 옮김과 백업 왕복" env BANGJU_ARCHIVE_SETTLE=now node t13.cjs "$B1" "$R1" $P1 "$L1" "$BASE" "$ROOT"
finish; ./stop.sh $P1 > /dev/null 2>&1

# the page in a real browser (needs Chrome and puppeteer-core)
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
if [ -n "$CHROME" ]; then
  if ! NODE_PATH="${PUPPETEER_DIR:-$WORK/browser}/node_modules" node -e "require('puppeteer-core')" 2> /dev/null; then
    PUPPETEER_DIR="$WORK/browser"; mkdir -p "$PUPPETEER_DIR"
    (cd "$PUPPETEER_DIR" && npm init -y > /dev/null 2>&1 && npm install --no-audit --no-fund puppeteer-core > /dev/null 2>&1)
  fi
  if NODE_PATH="${PUPPETEER_DIR:-$WORK/browser}/node_modules" node -e "require('puppeteer-core')" 2> /dev/null; then
    start BANGJU_ARCHIVE_SETTLE_DELAY_MS=2000 && seeded && check "화면(실제 브라우저)" env NODE_PATH="${PUPPETEER_DIR:-$WORK/browser}/node_modules" CHROME="$CHROME" node page-test.cjs "$BASE" "$WORK/page.png"; finish
  else SKIPPED=$((SKIPPED + 1)); SUMMARY="$SUMMARY\n  건너뜀  화면(실제 브라우저): puppeteer-core를 받지 못함"; fi
else SKIPPED=$((SKIPPED + 1)); SUMMARY="$SUMMARY\n  건너뜀  화면(실제 브라우저): Chrome 없음"; fi

if [ $SCALE -eq 1 ]; then
  start BANGJU_ARCHIVE_SETTLE_DELAY_MS=3000 && NODE_OPTIONS=--max-old-space-size=5000 node seed3.cjs "$BASE" 1150 > /dev/null 2>&1 \
    && check "t11 많이 옮길 때(봇 1,150개)" env NODE_OPTIONS=--max-old-space-size=5000 node t11.cjs "$BASE"; finish
fi

if [ $APP -eq 1 ]; then
  out="$(cd "$REPO" && pnpm exec vitest run --config vitest.config.server.ts 2>&1)"; code=$?
  line="$(grep -E '^ +Tests ' <<< "$out" | tail -1 | sed 's/^ *//')"
  if [ $code -eq 0 ]; then PASSED=$((PASSED + 1)); SUMMARY="$SUMMARY\n  통과  앱의 서버 테스트 ($line)"; echo "=== 앱의 서버 테스트: 통과 ($line)"
  else FAILED=$((FAILED + 1)); SUMMARY="$SUMMARY\n  실패  앱의 서버 테스트 ($line)"; echo "=== 앱의 서버 테스트: 실패"; tail -40 <<< "$out"; fi
fi

echo; echo "방주 전체 점검: 통과 $PASSED, 실패 $FAILED, 건너뜀 $SKIPPED"; echo -e "$SUMMARY"
[ $FAILED -eq 0 ] && rm -rf "$WORK"
[ $FAILED -eq 0 ]
