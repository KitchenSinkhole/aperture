#!/usr/bin/env bash
# One-time backfill: adds every currently-open issue not yet on the project
# board, landing assigned issues in "In Progress" and unassigned ones in
# "Backlog". Not a permanent workflow — run once locally after this
# automation lands, then delete or ignore.
#
# Requires: gh CLI authenticated as a user with org Projects:write, and
# PROJECT_AUTOMATION_TOKEN exported as GH_TOKEN (or an equivalently scoped
# token) so the shared scripts it calls can hit the GraphQL API.
set -euo pipefail

REPO="${REPO:-KitchenSinkhole/aperture}"
export REPO

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

gh issue list --repo "$REPO" --state open --limit 1000 \
  --json number,assignees --jq '.[] | "\(.number) \((.assignees | length))"' |
while read -r ISSUE_NUMBER ASSIGNEE_COUNT; do
  export ISSUE_NUMBER
  bash "$SCRIPT_DIR/add-issue-to-backlog.sh"
  if [ "$ASSIGNEE_COUNT" -gt 0 ]; then
    bash "$SCRIPT_DIR/set-issue-status.sh" "In Progress"
  fi
done

echo "Backfill complete."
