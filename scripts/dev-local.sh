#!/usr/bin/env bash
# One command to run the whole local candidate:
#   - start (or reuse) a local Anvil on 18545
#   - deploy the mock stack if it is missing (e.g. after an Anvil reset)
#   - run the API on 4317 and the web dev server on 5174
# Only processes this script starts are cleaned up on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

ANVIL_PORT="${SPROUT_ANVIL_PORT:-18545}"
RPC_URL="http://127.0.0.1:${ANVIL_PORT}"
API_PORT="${SPROUT_PORT:-4317}"
WEB_PORT="${SPROUT_WEB_PORT:-5174}"
OWN_ANVIL=0
ANVIL_PID=""
SERVER_PID=""
WEB_PID=""

rpc_up() {
  curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$RPC_URL"
}

cleanup() {
  # Kill process groups we started, including children (e.g. vite under bun run).
  for pid in "$SERVER_PID" "$WEB_PID"; do
    [ -n "$pid" ] || continue
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  done
  if [ "$OWN_ANVIL" = "1" ] && [ -n "$ANVIL_PID" ]; then
    kill -TERM "$ANVIL_PID" 2>/dev/null || true
  fi
  sleep 1
  for pid in "$SERVER_PID" "$WEB_PID" "$ANVIL_PID"; do
    [ -n "$pid" ] || continue
    kill -KILL "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if ! rpc_up; then
  echo "starting anvil on port ${ANVIL_PORT}"
  anvil --port "$ANVIL_PORT" --chain-id 31337 >/tmp/sprout-anvil.log 2>&1 &
  ANVIL_PID=$!
  OWN_ANVIL=1
  for _ in $(seq 1 50); do
    rpc_up && break
    sleep 0.2
  done
fi

# Refuse to deploy against anything that is not a 31337 dev chain.
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo unknown)"
if [ "$CHAIN_ID" != "31337" ]; then
  echo "refusing to deploy: RPC at ${RPC_URL} reports chain id '${CHAIN_ID}', not 31337"
  exit 1
fi

forge build --root contracts >/dev/null

# Reuse an existing deployment only if its factory is actually present on the
# current chain. An anvil reset wipes code, so we redeploy instead of pointing at
# stale addresses.
REUSE=0
if [ -f tmp/local.env ]; then
  # shellcheck disable=SC1091
  source tmp/local.env
  if [ "${SPROUT_DEPLOYMENT_VERSION:-}" != "3" ]; then
    echo "existing deployment predates the current contract layout; redeploying"
  elif [ -n "${SPROUT_FACTORY_ADDRESS:-}" ]; then
    CODE="$(cast code "$SPROUT_FACTORY_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo 0x)"
    if [ "$CODE" != "0x" ] && [ -n "$CODE" ]; then
      REUSE=1
    fi
  fi
fi

if [ "$REUSE" != "1" ]; then
  echo "deploying local stack"
  SPROUT_RPC_URL="$RPC_URL" bun run scripts/deploy-local.ts
fi

# Export every value from the generated env file to the child processes.
set -a
# shellcheck disable=SC1091
source tmp/local.env
set +a
export SPROUT_PORT="$API_PORT"

echo ""
echo "Sprout local stack:"
echo "  API   http://127.0.0.1:${API_PORT}"
echo "  Web   http://127.0.0.1:${WEB_PORT}"
echo "  RPC   ${RPC_URL} (chain 31337)"
echo "  Reused existing deployment: ${REUSE}"
echo "Press Ctrl-C to stop."
echo ""

bun server/src/index.ts &
SERVER_PID=$!
bun run --cwd web dev -- --port "$WEB_PORT" &
WEB_PID=$!

# Fail fast if a service we own exits, instead of waiting on Anvil forever.
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "API server exited unexpectedly"
    exit 1
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "web server exited unexpectedly"
    exit 1
  fi
  if [ "$OWN_ANVIL" = "1" ] && ! kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "anvil exited unexpectedly"
    exit 1
  fi
  sleep 1
done
