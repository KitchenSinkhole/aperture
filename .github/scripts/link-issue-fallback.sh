#!/usr/bin/env bash
# Injects "Closes #N" into a PR body when the AI author mentioned the issue
# without the closing keyword. Requires GH_TOKEN, REPO, PR_NUMBER, PR_BODY,
# PR_TITLE, BRANCH in the environment.
set -euo pipefail

EXISTING="$(gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){ closingIssuesReferences(first:1){ totalCount } }
  }
}' -f owner="${REPO%/*}" -f repo="${REPO#*/}" -F pr="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.closingIssuesReferences.totalCount')"

if [ "$EXISTING" -gt 0 ]; then
  echo "PR #$PR_NUMBER already links an issue — nothing to do."
  exit 0
fi

ISSUE_NUM=""
if [[ "$BRANCH" =~ ^([0-9]+)- ]]; then
  ISSUE_NUM="${BASH_REMATCH[1]}"
fi

if [ -z "$ISSUE_NUM" ]; then
  HAYSTACK="$PR_TITLE"$'\n'"$PR_BODY"
  if [[ "$HAYSTACK" =~ \#([0-9]+) ]]; then
    ISSUE_NUM="${BASH_REMATCH[1]}"
  fi
fi

if [ -z "$ISSUE_NUM" ]; then
  gh pr comment "$PR_NUMBER" --body \
    "No linked issue detected on this PR. Add \`Closes #<issue-number>\` to the description so it closes automatically when this merges to \`master\`."
  exit 0
fi

printf '%s\n\nCloses #%s\n' "$PR_BODY" "$ISSUE_NUM" | gh pr edit "$PR_NUMBER" --body-file -
echo "Injected 'Closes #$ISSUE_NUM' into PR #$PR_NUMBER."
