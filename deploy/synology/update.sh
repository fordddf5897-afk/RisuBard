#!/bin/bash
# 시놀로지 자동 업데이트: 새 이미지가 있으면 받아서 컨테이너를 다시 시작합니다.
# DSM 작업 스케줄러에서 root 권한으로 하루 한 번 실행하세요.
#   bash /volume1/docker/risubard/update.sh
# 결과는 같은 폴더의 update.log에 남습니다. 데이터 폴더(save)는 건드리지 않습니다.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
LOG="$DIR/update.log"
CONTAINER="${CONTAINER:-risubard}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

if docker compose version >/dev/null 2>&1; then
    DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    DC=(docker-compose)
else
    log "실패: docker compose 명령을 찾지 못했습니다. Container Manager가 설치되어 있는지 확인하세요."
    exit 1
fi

before="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"

if ! "${DC[@]}" pull --quiet >> "$LOG" 2>&1; then
    log "실패: 이미지를 받지 못했습니다. 인터넷 연결이나 레지스트리 로그인을 확인하세요."
    exit 1
fi
"${DC[@]}" up -d >> "$LOG" 2>&1

after="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
if [[ -n "$after" && "$before" != "$after" ]]; then
    log "업데이트함: ${before:7:12} -> ${after:7:12}"
    docker image prune -f >/dev/null 2>&1 || true
else
    log "변경 없음"
fi

# 로그는 최근 300줄만 남깁니다.
tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
