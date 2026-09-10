#!/usr/bin/env bash
# Adds a newly opened issue to the maintainer project board (if not already
# present) and sets its Status to "Backlog". Requires GH_TOKEN with org
# Projects:write (PROJECT_AUTOMATION_TOKEN), REPO ("owner/name"), and
# ISSUE_NUMBER in the environment.
set -euo pipefail

PROJECT_OWNER="KitchenSinkhole"
PROJECT_NUMBER=2

read -r ISSUE_ID ITEM_ID <<<"$(gh api graphql -f query='
query($owner:String!,$repo:String!,$issue:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$issue){
      id
      projectItems(first:10){ nodes{ id project{ number } } }
    }
  }
}' -f owner="${REPO%/*}" -f repo="${REPO#*/}" -F issue="$ISSUE_NUMBER" \
  --jq --argjson num "$PROJECT_NUMBER" \
  '.data.repository.issue | "\(.id) \((.projectItems.nodes[] | select(.project.number==$num) | .id) // "")"')"

PROJECT_ID="$(gh api graphql -f query='
query($owner:String!,$number:Int!){
  organization(login:$owner){ projectV2(number:$number){ id } }
}' -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" \
  --jq '.data.organization.projectV2.id')"

if [ -z "$ITEM_ID" ]; then
  ITEM_ID="$(gh api graphql -f query='
  mutation($project:ID!,$content:ID!){
    addProjectV2ItemById(input:{ projectId:$project, contentId:$content }){
      item{ id }
    }
  }' -f project="$PROJECT_ID" -f content="$ISSUE_ID" \
    --jq '.data.addProjectV2ItemById.item.id')"
  echo "Added issue #$ISSUE_NUMBER to project #$PROJECT_NUMBER as item $ITEM_ID."
fi

bash "$(dirname "$0")/set-issue-status.sh" "Backlog"
