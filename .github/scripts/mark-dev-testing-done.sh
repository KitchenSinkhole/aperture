#!/usr/bin/env bash
# A release ships everything currently staged, not just the commits in one
# push — so this bulk-moves every item sitting in "Dev Testing" to "Done"
# rather than tracing individual commits/PRs across the dev->master merge.
# Requires GH_TOKEN with org Projects:write (PROJECT_AUTOMATION_TOKEN).
set -euo pipefail

PROJECT_OWNER="KitchenSinkhole"
PROJECT_NUMBER=2

read -r PROJECT_ID FIELD_ID FROM_OPTION_ID TO_OPTION_ID <<<"$(gh api graphql -f query='
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
  --jq '.data.organization.projectV2 |
    "\(.id) \(.field.id) \((.field.options[] | select(.name=="Dev Testing") | .id)) \((.field.options[] | select(.name=="Done") | .id))"')"

if [ -z "$FROM_OPTION_ID" ] || [ -z "$TO_OPTION_ID" ]; then
  echo "::error::Missing \"Dev Testing\" or \"Done\" Status option on project #$PROJECT_NUMBER."
  exit 1
fi

fetch_page() {
  if [ -n "$1" ]; then
    gh api graphql -f query='
    query($project:ID!,$cursor:String){
      node(id:$project){
        ... on ProjectV2{
          items(first:100, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{
              id
              fieldValueByName(name:"Status"){
                ... on ProjectV2ItemFieldSingleSelectValue{ optionId }
              }
            }
          }
        }
      }
    }' -f project="$PROJECT_ID" -f cursor="$1"
  else
    gh api graphql -f query='
    query($project:ID!){
      node(id:$project){
        ... on ProjectV2{
          items(first:100){
            pageInfo{ hasNextPage endCursor }
            nodes{
              id
              fieldValueByName(name:"Status"){
                ... on ProjectV2ItemFieldSingleSelectValue{ optionId }
              }
            }
          }
        }
      }
    }' -f project="$PROJECT_ID"
  fi
}

CURSOR=""
MOVED=0
while :; do
  PAGE="$(fetch_page "$CURSOR")"

  ITEM_IDS="$(echo "$PAGE" | jq -r --arg opt "$FROM_OPTION_ID" \
    '.data.node.items.nodes[] | select(.fieldValueByName.optionId==$opt) | .id')"

  while IFS= read -r ITEM_ID; do
    [ -z "$ITEM_ID" ] && continue
    gh api graphql -f query='
    mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
      updateProjectV2ItemFieldValue(input:{
        projectId:$project, itemId:$item, fieldId:$field,
        value:{ singleSelectOptionId:$option }
      }){ projectV2Item{ id } }
    }' -f project="$PROJECT_ID" -f item="$ITEM_ID" -f field="$FIELD_ID" -f option="$TO_OPTION_ID" >/dev/null
    MOVED=$((MOVED + 1))
    echo "Moved project item $ITEM_ID to \"Done\"."
  done <<<"$ITEM_IDS"

  HAS_NEXT="$(echo "$PAGE" | jq -r '.data.node.items.pageInfo.hasNextPage')"
  if [ "$HAS_NEXT" != "true" ]; then
    break
  fi
  CURSOR="$(echo "$PAGE" | jq -r '.data.node.items.pageInfo.endCursor')"
done

echo "Moved $MOVED item(s) from \"Dev Testing\" to \"Done\"."
