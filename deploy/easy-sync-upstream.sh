#!/usr/bin/env bash
# Manual version of the daily GitHub workflow: merge the latest RisuBard (or another
# upstream) into this easy-mode fork and run the checks. Usually you do not need this;
# .github/workflows/easy-mode-sync.yml does the same every day.
#
#   ./deploy/easy-sync-upstream.sh                 # rpaddict/RisuBard main
#   UPSTREAM_URL=https://github.com/kwaroran/RisuAI.git UPSTREAM_BRANCH=main ./deploy/easy-sync-upstream.sh
set -euo pipefail
cd "$(dirname "$0")/.."

set +e
bash deploy/easy-ci-sync.sh
code=$?
set -e

if [[ $code -eq 2 ]]; then
    echo
    echo "충돌이 났습니다. 병합은 취소했고 파일은 그대로입니다." >&2
    echo "간편 모드가 건드리는 기존 파일은 docs/easy-mode.md의 '기존 파일 연결점'에 정리되어 있습니다." >&2
    exit 2
elif [[ $code -ne 0 ]]; then
    exit $code
fi

pnpm install --frozen-lockfile
bash deploy/easy-ci-check.sh

echo
echo "끝났습니다. 'git push'로 올리면 GitHub가 새 이미지를 만듭니다."
