#!/usr/bin/env bash
set -euo pipefail

# Deploys wishlist-app to Firebase (Functions + Hosting + Firestore rules),
# then optionally seeds a shops/{shop} Firestore doc and/or triggers /install.
#
# Secrets (apiKey/apiSecret) are NEVER hardcoded here — pass them as CLI args
# or env vars at run time so nothing sensitive is committed to git.
#
# Requirements:
#   - firebase-tools installed (`npm install -g firebase-tools`) and `firebase login` done
#   - .firebaserc "default" project id set to your real Firebase project
#   - GOOGLE_APPLICATION_CREDENTIALS set to a service account key JSON path
#     (needed only for --seed-shop, to write to production Firestore)
#
# Usage:
#   ./scripts/deploy.sh
#       Deploy only (functions + hosting + firestore rules).
#
#   ./scripts/deploy.sh --seed-shop <shop> <apiKey> <apiSecret>
#       Deploy, then seed/update shops/<shop> in production Firestore.
#
#   ./scripts/deploy.sh --seed-shop <shop> <apiKey> <apiSecret> --install
#       Deploy, seed the shop, then call POST /install for it.
#       Requires APP_URL and INSTALL_SECRET env vars to be set.
#
#   ./scripts/deploy.sh --install-all
#       Deploy, then call POST /install for every non-disabled shop already
#       in Firestore — pushes updated storefront assets everywhere without
#       needing per-shop manual triggering. Requires GOOGLE_APPLICATION_CREDENTIALS,
#       APP_URL, and INSTALL_SECRET.
#
# Example (fill in your real service account key path):
#   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
#   APP_URL=https://your-deployed-domain \
#   INSTALL_SECRET=your-install-secret \
#     ./scripts/deploy.sh --seed-shop khazhjp.myshopify.com <apiKey> <apiSecret> --install

SEED_SHOP=false
DO_INSTALL=false
INSTALL_ALL=false
SHOP="${SHOP:-}"
SHOP_API_KEY="${SHOP_API_KEY:-}"
SHOP_API_SECRET="${SHOP_API_SECRET:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed-shop)
      SEED_SHOP=true
      shift
      if [[ $# -ge 3 && "$1" != --* ]]; then
        SHOP="$1"
        SHOP_API_KEY="$2"
        SHOP_API_SECRET="$3"
        shift 3
      fi
      ;;
    --install)
      DO_INSTALL=true
      shift
      ;;
    --install-all)
      INSTALL_ALL=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v firebase >/dev/null 2>&1; then
  echo "firebase-tools not found. Install with: npm install -g firebase-tools" >&2
  exit 1
fi

echo "==> Deploying functions, hosting, and Firestore rules"
# --non-interactive: needed for CI, and avoids getting stuck on prompts locally
# (e.g. "how many days to keep container images") — always picks defaults.
firebase deploy --only functions,hosting,firestore:rules --non-interactive

if $SEED_SHOP; then
  if [[ -z "$SHOP" || -z "$SHOP_API_KEY" || -z "$SHOP_API_SECRET" ]]; then
    echo "Missing shop credentials. Pass them as: --seed-shop <shop> <apiKey> <apiSecret>" >&2
    echo "or export SHOP / SHOP_API_KEY / SHOP_API_SECRET first." >&2
    exit 1
  fi
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    echo "GOOGLE_APPLICATION_CREDENTIALS is not set. Set it to a service account" >&2
    echo "key path so add-shop.js writes to production Firestore (not the emulator)." >&2
    exit 1
  fi
  echo "==> Seeding shops/$SHOP in Firestore"
  npm run add-shop -- "$SHOP" "$SHOP_API_KEY" "$SHOP_API_SECRET"
fi

if $DO_INSTALL; then
  if [[ -z "${APP_URL:-}" || -z "${INSTALL_SECRET:-}" ]]; then
    echo "APP_URL and INSTALL_SECRET env vars are required for --install." >&2
    exit 1
  fi
  if [[ -z "$SHOP" ]]; then
    echo "--install requires --seed-shop <shop> ... to also have been passed." >&2
    exit 1
  fi
  echo "==> Calling POST /install for $SHOP"
  curl -fsS -X POST "${APP_URL}/install?shop=${SHOP}" -H "x-install-secret: ${INSTALL_SECRET}"
  echo
fi

if $INSTALL_ALL; then
  if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" || -z "${APP_URL:-}" || -z "${INSTALL_SECRET:-}" ]]; then
    echo "GOOGLE_APPLICATION_CREDENTIALS, APP_URL, and INSTALL_SECRET env vars are required for --install-all." >&2
    exit 1
  fi
  echo "==> Calling POST /install for every configured shop"
  npm run install-all-shops
fi

echo "==> Done"
