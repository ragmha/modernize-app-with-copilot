#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
npm ci --ignore-scripts --no-fund --no-audit
npm test
node scripts/lab.mjs setup

if ! gh aw --version >/dev/null 2>&1; then
  gh extension install github/gh-aw --pin v0.86.2
fi
gh aw --version

printf '\nReady. Start with: npm run lab -- doctor && npm run lab -- test both\n'
printf 'Database containers and Azure resources have NOT been started.\n'
printf 'Open the exercise issue in YOUR repository for the first lesson.\n'
