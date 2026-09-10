#!/usr/bin/env bash
# Moves a single issue (already known by number, not discovered via a PR's
# closingIssuesReferences) to a given Status option on the maintainer project
# board. Requires GH_TOKEN with org Projects:write (PROJECT_AUTOMATION_TOKEN —
# see docs/RELEASING.md or AGENTS.md for setup), REPO ("owner/name"), and
# ISSUE_NUMBER in the environment.
#
# Shared by issue-opened.yml (-> Backlog) and issue-assigned.yml (-> In Progress).
set -euo pipefail

STATUS_NAME="$1"
PROJECT_OWNER="KitchenSinkhole"
PROJECT_NUMBER=2

read -r PROJECT_ID FIELD_ID OPTION_ID <<<"$(gh api graphql -f query='
query($owner:String!,$number:Int!){
  organization(login:$owner){
    projectV2(number:$number){
      id
      field(name:"Status"){
        ... on ProjectV2SingleSelectField{
          id
          options{ id name }
        }
      }
    }
  }
}' -f owner="$PROJECT_OWNER" -F number="$PROJECT_NUMBER" \
  --jq --arg status "$STATUS_NAME" \
  '.data.organization.projectV2 | "\(.id) \(.field.id) \((.field.options[] | select(.name==$status) | .id))"')"

if [ -z "$OPTION_ID" ]; then
  echo "::error::No Status option named \"$STATUS_NAME\" on project #$PROJECT_NUMBER."
  exit 1
fi

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

if [ -z "$ITEM_ID" ]; then
  echo "Issue #$ISSUE_NUMBER isn't on project #$PROJECT_NUMBER — skipping."
  exit 0
fi

gh api graphql -f query='
mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
  updateProjectV2ItemFieldValue(input:{
    projectId:$project, itemId:$item, fieldId:$field,
    value:{ singleSelectOptionId:$option }
  }){ projectV2Item{ id } }
}' -f project="$PROJECT_ID" -f item="$ITEM_ID" -f field="$FIELD_ID" -f option="$OPTION_ID" >/dev/null

echo "Moved issue #$ISSUE_NUMBER (project item $ITEM_ID) to \"$STATUS_NAME\"."
