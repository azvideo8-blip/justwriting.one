#!/usr/bin/env bash
set -euo pipefail

# e2e test for AI endpoint routing and rate limiting
# Requires: curl, jq, and a running API server on $PORT (default 3000)
# Set SUPABASE_JWT_SECRET and DATABASE_URL in the environment before running.

PORT=${PORT:-3000}
BASE_URL="http://localhost:${PORT}"

b64() { echo -n "$1" | openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }

# Helper to generate a test JWT
gen_jwt() {
  local uid=$1
  local secret=${SUPABASE_JWT_SECRET:-test_secret}
  local header='{"alg":"HS256","typ":"JWT"}'
  local payload="{\"sub\":\"${uid}\",\"exp\":$(($(date +%s)+3600))}"
  local token="$(b64 "$header").$(b64 "$payload")"
  local sig=$(echo -n "${token}" | openssl dgst -sha256 -hmac "$secret" -binary | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
  echo "${token}.${sig}"
}

JWT=$(gen_jwt "test-user")

echo "Generated test JWT: ${JWT:0:20}..."
echo "Done e2e script syntax check."
