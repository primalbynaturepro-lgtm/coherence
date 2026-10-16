#!/usr/bin/env bash
# Publish Cohérence: give this build its version, then send it to Vercel (project "coherence", team dogbynature).
#
#   bash ~/Work/Apps/coherence/deploy.sh
#
# The first time it also creates and links the Vercel project. Nothing is committed or pushed anywhere.
set -euo pipefail
cd "$(dirname "$0")"

SCOPE="dogbynature"
PROJECT="coherence"

command -v node >/dev/null   || { echo "✗ Node is needed (it is what the Vercel command line runs on)." >&2; exit 1; }
command -v vercel >/dev/null || { echo "✗ The Vercel command line is not installed:  npm i -g vercel" >&2; exit 1; }

node scripts/stamp.js

if [ ! -f .vercel/project.json ]; then
  # Say it out loud if the Vercel command line is not signed in (the checks below hide their output).
  vercel whoami >/dev/null || { echo "✗ Not signed in to Vercel:  vercel login   then run this again." >&2; exit 1; }

  # A project of that name that this folder does not know would be published over. Say so instead of doing it.
  known=0
  if vercel project inspect "$PROJECT" --scope "$SCOPE" >/dev/null 2>&1; then known=1; fi
  listing="$(vercel project ls --scope "$SCOPE" 2>/dev/null || true)"
  if [ "$known" = 0 ] && grep -qE "^[[:space:]]*${PROJECT}[[:space:]]" <<<"$listing"; then known=1; fi
  if [ "$known" = 1 ]; then
    echo "✗ The team '$SCOPE' already has a Vercel project called '$PROJECT', and this folder is not linked to it." >&2
    echo "  If it is this app from another machine:  vercel link --scope $SCOPE --project $PROJECT   then run this again." >&2
    echo "  If it is something else: change PROJECT at the top of this file, then run it again." >&2
    exit 1
  fi

  echo "• First publication: creating and linking the Vercel project '$PROJECT' in team '$SCOPE'."
  vercel link --yes --scope "$SCOPE" --project "$PROJECT" || {
    echo "• The link did not create the project by itself; creating it, then linking."
    vercel project add "$PROJECT" --scope "$SCOPE"
    vercel link --yes --scope "$SCOPE" --project "$PROJECT"
  }
fi

vercel deploy --prod --yes --scope "$SCOPE"
echo
echo "✓ Published. On the iPhone, in Chrome, take the address printed after « Aliased » and FIRST open it with /lab/pulse.html at the end:"
echo "  that page shows whether the flash lights and the pulse is read. Then Share → Add to Home Screen, and open the app from its icon."
