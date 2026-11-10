#!/usr/bin/env bash
# Merges the latest upstream RisuBard into the current branch.
# Used by .github/workflows/easy-mode-sync.yml and deploy/easy-sync-upstream.sh.
#
# Result, printed and (in GitHub Actions) written to $GITHUB_OUTPUT:
#   status=up-to-date   nothing new upstream                    exit 0
#   status=merged       upstream merged, nothing pushed yet     exit 0
#   status=conflict     merge aborted, working tree unchanged   exit 2
#   conflicts=a,b,c     files that conflicted (status=conflict only)
#   upstream_sha=...    upstream commit that was checked
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/rpaddict/RisuBard.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
REMOTE="${UPSTREAM_REMOTE:-upstream}"

emit() {
    echo "$1"
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "커밋하지 않은 변경이 있어 병합을 시작하지 않습니다." >&2
    exit 1
fi

if git remote get-url "$REMOTE" >/dev/null 2>&1; then
    git remote set-url "$REMOTE" "$UPSTREAM_URL"
else
    git remote add "$REMOTE" "$UPSTREAM_URL"
fi
git fetch --no-tags "$REMOTE" "$UPSTREAM_BRANCH"

TARGET="$REMOTE/$UPSTREAM_BRANCH"
UPSTREAM_SHA="$(git rev-parse "$TARGET")"
emit "upstream_sha=$UPSTREAM_SHA"

if git merge-base --is-ancestor "$TARGET" HEAD; then
    emit "status=up-to-date"
    exit 0
fi

UPSTREAM_VERSION="$(git show "$TARGET:package.json" 2>/dev/null | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
MESSAGE="chore: merge RisuBard ${UPSTREAM_VERSION:-upstream} (${UPSTREAM_SHA:0:7})"

if git merge --no-edit --no-ff -m "$MESSAGE" "$TARGET"; then
    emit "status=merged"
    emit "upstream_version=${UPSTREAM_VERSION}"
    exit 0
fi

CONFLICTS="$(git diff --name-only --diff-filter=U | paste -sd, -)"
git merge --abort
emit "status=conflict"
emit "conflicts=$CONFLICTS"
emit "upstream_version=${UPSTREAM_VERSION}"
exit 2
