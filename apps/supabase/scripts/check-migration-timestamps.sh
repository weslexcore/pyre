#!/usr/bin/env bash
# Check that every migration this branch adds is stamped with a real, current
# UTC time — newer than anything on the base branch, unique, and not in the
# future. `supabase db push` (run on merge by .github/workflows/
# supabase-migrations.yml) refuses a migration older than one production has
# already applied, so this catches that before merge instead of after.
#
# Usage: check-migration-timestamps.sh [base-ref]   (default: origin/master)
# Create migrations with `yarn workspace @pyre/supabase new <name>` and this
# never fails.

set -euo pipefail

BASE="${1:-origin/master}"
ROOT="$(git rev-parse --show-toplevel)"
DIR="apps/supabase/migrations"
NAME_RE='^[0-9]{14}_[a-z0-9_]+\.sql$'

if ! git -C "$ROOT" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null; then
  echo "Base ref '$BASE' not found; fetch it first (git fetch origin master)." >&2
  exit 2
fi

base_files="$(git -C "$ROOT" ls-tree --name-only "$BASE" "$DIR/" | xargs -rn1 basename | sort)"
here_files="$(find "$ROOT/$DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)"
added="$(comm -13 <(echo "$base_files") <(echo "$here_files"))"

if [ -z "$added" ]; then
  echo "No new migrations against $BASE."
  exit 0
fi

newest_base="$(echo "$base_files" | grep -E '^[0-9]{14}_' | cut -c1-14 | sort | tail -n1)"
now="$(date -u +%Y%m%d%H%M%S)"
limit="$(date -u -d '+1 hour' +%Y%m%d%H%M%S)"
failed=0

fail() {
  echo "✗ $1: $2"
  echo "    fix: git mv $DIR/$1 $DIR/\$(date -u +%Y%m%d%H%M%S)_${1#*_}"
  failed=1
}

while IFS= read -r file; do
  stamp="${file:0:14}"
  if ! [[ "$file" =~ $NAME_RE ]]; then
    echo "✗ $file: name must be YYYYMMDDHHmmss_lowercase_words.sql"
    failed=1
    continue
  fi
  iso="${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:8:2}:${stamp:10:2}:${stamp:12:2}"
  if [ "$(date -u -d "$iso" +%Y%m%d%H%M%S 2>/dev/null || true)" != "$stamp" ]; then
    fail "$file" "$stamp is not a real date and time"
  elif [ -n "$newest_base" ] && [[ ! "$stamp" > "$newest_base" ]]; then
    fail "$file" "$stamp is not newer than $newest_base, the newest migration on $BASE; db push would refuse it"
  elif [[ "$stamp" > "$limit" ]]; then
    fail "$file" "$stamp is in the future (now is $now UTC); use the time it was created"
  elif [ "$(echo "$here_files" | cut -c1-14 | grep -c "^$stamp\$")" -gt 1 ]; then
    fail "$file" "another migration already uses $stamp"
  else
    echo "✓ $file"
  fi
done <<< "$added"

if [ "$failed" -ne 0 ]; then
  echo
  echo "Migrations must be stamped with the current UTC time when created:"
  echo "  yarn workspace @pyre/supabase new <name>"
  exit 1
fi
