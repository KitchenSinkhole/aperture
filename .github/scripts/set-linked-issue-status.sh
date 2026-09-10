#!/usr/bin/env bash
# Moves every issue the current PR closes to a given Status option on the
# maintainer project board. Requires GH_TOKEN with org Projects:write
# (PROJECT_AUTOMATION_TOKEN — see docs/RELEASING.md or AGENTS.md for setup),
# REPO ("owner/name"), and PR_NUMBER in the environment.
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

ISSUE_NODE_IDS="$(gh api graphql -f query='
query($owner:String!,$repo:String!,$pr:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$pr){
      closingIssuesReferences(first:20){ nodes{ id number } }
    }
  }
}' -f owner="${REPO%/*}" -f repo="${REPO#*/}" -F pr="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].id')"

if [ -z "$ISSUE_NODE_IDS" ]; then
  echo "No linked issues on PR #$PR_NUMBER — nothing to move."
  exit 0
fi

while IFS= read -r ISSUE_ID; do
  ITEM_ID="$(gh api graphql -f query='
  query($issueId:ID!){
    node(id:$issueId){
      ... on Issue{
        projectItems(first:10){
          nodes{ id project{ number } }
        }
      }
    }
  }' -f issueId="$ISSUE_ID" \
    --jq --argjson num "$PROJECT_NUMBER" \
    '.data.node.projectItems.nodes[] | select(.project.number==$num) | .id')"

  if [ -z "$ITEM_ID" ]; then
    echo "Issue node $ISSUE_ID isn't on project #$PROJECT_NUMBER — skipping."
    continue
  fi

  gh api graphql -f query='
  mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
    updateProjectV2ItemFieldValue(input:{
      projectId:$project, itemId:$item, fieldId:$field,
      value:{ singleSelectOptionId:$option }
    }){ projectV2Item{ id } }
  }' -f project="$PROJECT_ID" -f item="$ITEM_ID" -f field="$FIELD_ID" -f option="$OPTION_ID" >/dev/null

  echo "Moved project item $ITEM_ID to \"$STATUS_NAME\"."
done <<<"$ISSUE_NODE_IDS"
