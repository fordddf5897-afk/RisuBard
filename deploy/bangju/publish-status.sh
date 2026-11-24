#!/bin/bash
# 방주 상태 가지(bangju-status)에 파일을 올린다. 그 가지의 다른 파일은 그대로 둔다.
# 가지에는 늘 커밋 하나만 남는다(기록이 쌓이지 않게). 두 작업이 동시에 올려도 서로의 파일을 지우지 않는다.
#
#   publish-status.sh "<커밋 메시지>" <파일>...
#   STATUS_REMOTE  올릴 곳. 없으면 GH_TOKEN과 GITHUB_REPOSITORY로 만든다.
#   STATUS_BRANCH  가지 이름(기본 bangju-status)
set -euo pipefail

message="${1:?커밋 메시지가 필요합니다}"; shift
[ "$#" -gt 0 ] || { echo "올릴 파일이 없습니다." >&2; exit 1; }
branch="${STATUS_BRANCH:-bangju-status}"
remote="${STATUS_REMOTE:-https://x-access-token:${GH_TOKEN:?GH_TOKEN이 필요합니다}@github.com/${GITHUB_REPOSITORY:?}.git}"

files=()
for file in "$@"; do
  [ -f "$file" ] || { echo "파일이 없습니다: $file" >&2; exit 1; }
  files+=("$(cd "$(dirname "$file")" && pwd)/$(basename "$file")")
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for attempt in 1 2 3 4; do
  rm -rf "$work/tree" "$work/old"
  mkdir -p "$work/tree" "$work/old"
  # what is on the branch now
  seen=""
  git -C "$work/old" init -q
  if git -C "$work/old" fetch -q --depth 1 "$remote" "$branch" 2>/dev/null; then
    seen="$(git -C "$work/old" rev-parse FETCH_HEAD)"
    git -C "$work/old" archive FETCH_HEAD | tar -x -C "$work/tree"
  fi
  cp "${files[@]}" "$work/tree/"
  printf '%s\n' "방주가 쓰는 상태 파일입니다. GitHub 작업이 덮어씁니다. 직접 고치지 마세요." > "$work/tree/README.md"

  git -C "$work/tree" init -q -b "$branch"
  git -C "$work/tree" add -A
  git -C "$work/tree" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "$message"
  # Replaces the branch only if nobody else changed it meanwhile; otherwise reads it again.
  if git -C "$work/tree" push -q --force-with-lease="$branch:$seen" "$remote" "HEAD:refs/heads/$branch" 2>"$work/push.err"; then
    echo "published to $branch: $(cd "$work/tree" && ls | tr '\n' ' ')"
    exit 0
  fi
  echo "다른 작업이 먼저 올렸습니다. 다시 읽고 올립니다(${attempt}번째)." >&2
  sleep $((attempt * 3))
done
sed 's#x-access-token:[^@]*@#x-access-token:***@#g' "$work/push.err" >&2 || true
echo "상태 가지에 올리지 못했습니다." >&2
exit 1
