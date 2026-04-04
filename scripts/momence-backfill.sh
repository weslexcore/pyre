#!/usr/bin/env bash
set -euo pipefail

# Momence → Mailchimp backfill script
# Paginates through all Momence members and syncs them to Mailchimp.
#
# Usage:
#   ./scripts/momence-backfill.sh
#
# Environment:
#   MOMENCE_BACKFILL_SECRET - required, auth token for the backfill endpoint
#   BACKFILL_URL            - optional, defaults to production

BACKFILL_URL="${BACKFILL_URL:-https://pyresauna.com/api/webhooks/momence-backfill}"

if [ -z "${MOMENCE_BACKFILL_SECRET:-}" ]; then
  echo "Error: MOMENCE_BACKFILL_SECRET is not set"
  exit 1
fi

LIMIT=25
OFFSET=0
TOTAL_SYNCED=0
TOTAL_FAILED=0

echo "Starting Momence → Mailchimp backfill..."
echo "Endpoint: $BACKFILL_URL"
echo ""

while true; do
  echo "Fetching batch: offset=$OFFSET limit=$LIMIT"

  RESPONSE=$(curl -s -X POST "${BACKFILL_URL}?offset=${OFFSET}&limit=${LIMIT}" \
    -H "Authorization: Bearer ${MOMENCE_BACKFILL_SECRET}" \
    -H "Content-Type: application/json")

  echo "$RESPONSE"

  # Check for errors
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    echo "Response: $RESPONSE"
    exit 1
  fi

  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed')
  SUCCESSES=$(echo "$RESPONSE" | jq -r '.successes')
  FAILURES=$(echo "$RESPONSE" | jq -r '.failures | length')
  TOTAL_IN_MOMENCE=$(echo "$RESPONSE" | jq -r '.totalInMomence')
  NEXT_OFFSET=$(echo "$RESPONSE" | jq -r '.nextOffset')

  TOTAL_SYNCED=$((TOTAL_SYNCED + SUCCESSES))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILURES))

  echo "  Processed: $PROCESSED | Synced: $SUCCESSES | Failed: $FAILURES | Total in Momence: $TOTAL_IN_MOMENCE"

  # Show failures if any
  if [ "$FAILURES" -gt 0 ]; then
    echo "  Failed members:"
    echo "$RESPONSE" | jq -r '.failures[] | "    - \(.email): \(.error)"'
  fi

  # Check if done
  if [ "$NEXT_OFFSET" = "null" ]; then
    break
  fi

  OFFSET=$NEXT_OFFSET
  echo ""
done

echo ""
echo "Backfill complete!"
echo "  Total synced: $TOTAL_SYNCED"
echo "  Total failed: $TOTAL_FAILED"
