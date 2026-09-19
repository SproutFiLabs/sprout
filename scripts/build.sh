#!/usr/bin/env bash
# Compile contracts, regenerate ABIs, typecheck every package, and build the web app.
set -euo pipefail
cd "$(dirname "$0")/.."

forge build --root contracts
bun run scripts/gen-abis.ts
bun run scripts/gen-guardian.ts
bunx tsc -p shared/tsconfig.json --noEmit
bunx tsc -p server/tsconfig.json --noEmit
bunx tsc -p web/tsconfig.json --noEmit
bunx tsc -p scripts/tsconfig.json --noEmit
bun run --cwd web build
echo "build ok"
