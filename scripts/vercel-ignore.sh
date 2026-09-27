#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the apps in this monorepo. Each app's
# vercel.json runs this with its workspace name:
#
#   bash ../../scripts/vercel-ignore.sh @pyre/integrations
#
# Vercel reads the exit code: 0 skips the deployment, 1 builds it, and
# anything else fails it. turbo's `query affected --exit-code` answers 0 (not
# affected) or 1 (affected) but exits 2 when it cannot compare, so that is
# folded into 1 here: when in doubt, build.
#
# The one case turbo can never answer is the first push of a branch, where
# Vercel has no previous deployment and VERCEL_GIT_PREVIOUS_SHA is empty.
set -u

package="${1:?usage: vercel-ignore.sh <workspace-name>}"
base="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [ -z "$base" ]; then
  echo "No previous deployment on this branch; building ${package}."
  exit 1
fi

npx -y turbo@^2 query affected --base="$base" --packages "$package" --exit-code
status=$?

if [ "$status" -eq 0 ]; then
  echo "${package} is not affected since ${base}; skipping."
  exit 0
fi
if [ "$status" -ne 1 ]; then
  echo "turbo could not compare against ${base} (exit ${status}); building ${package}."
fi
exit 1
