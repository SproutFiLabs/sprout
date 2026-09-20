# Sprout v3 expansion

Five functional workspaces: Events & Match, Round-ups, Teen Arena, Cash Garden and Continuity. New financial functions require a new opt-in V3 vault. Existing vaults and their fixed beneficiary/graduation promises remain unchanged. Start from the current Spend/toolkit branch and merge the latest main branch so all existing features remain present.

## Product and execution boundaries

- Match escrow enforces sponsor funding, individual 30-day caps, expiry and refunds. New parent contributions trigger matches directly onchain, once per contribution.
- Round-ups observe finalized settlement-token outgoing transfers. The wallet explicitly delegates a weekly cap to a named executor. Bank/card observation and atomic ERC-4337 hooks are separate future integrations. The linked wallet is the parent wallet; no unsupported ownership claims.
- Arena mirrors a real vault snapshot into a persistent paper-money ledger, with bounded deterministic fills, replay, lessons and private leagues. Practice never signs chain transactions. Parent-defined readiness is a learning permission, not a bypass of beneficiary withdrawals.
- Cash parking uses an immutable, eligible ERC-4626 treasury integration. There is no verified Robinhood Chain treasury provider configured by this build. The production fallback is ordinary USDG. Local demonstrations use an explicitly labeled mock treasury, actual local transactions, and measured NAV changes; no projected return.
- Continuity is enforced by the new vault: original parent, named successor, co-guardian cancellation, heartbeat cadence, challenge period, explicit reserve installments and optional early graduation. Inactivity is not evidence of death. Direct contract activity/check-in counts; unrelated wallet activity does not automatically authorize an onchain heartbeat.
- Onchain transfers and roles remain public. Private offchain records are authenticated and encrypted at rest. Shielded settlement and key-ladder integrations referenced by the brief are absent from the starting repo and are not fabricated.

## Visual direction and recording plan

Cream paper, Satoshi, large green display type, orange/lavender/mint botanical illustrations drawn from the landing assets. Desktop-first layouts with contextual right-hand panels, deliberate spacing, strong form states, keyboard access, clear private/practice/local indicators and responsive mobile behavior.

Five 30-second voiceless films record actual local workflows: create/share event and fund a match; set round-ups and inspect a weekly sweep; mirror/trade/replay a practice portfolio; park/redeem cash and inspect measured value; write/check in/challenge a continuity plan. Instrumental score and sound effects only. Hold on each successful result and end with the exact SPROUT brand.

## Run and verify

From the repository root, with Bun and Foundry available:

```sh
bun install --frozen-lockfile
forge build --root contracts
bun scripts/ensure-fonts.mjs
bun run scripts/v3/start.ts
```

The isolated stack uses Anvil `127.0.0.1:28557`, API `127.0.0.1:4338`, and UI `127.0.0.1:5198`. The launcher refuses a non-local chain and deploys new contracts with public Anvil development accounts. Keep these ports free before starting it. Deployment details, the encrypted-record key and SQLite file live in ignored `tmp/v3/`. `scripts/v3/resume.ts` restarts only the API against that same still-running Anvil deployment; it does not redeploy or reset funds. Existing development servers are separate.

```sh
bun run typecheck
forge test --root contracts
bun --cwd server test
bun --cwd web test
bun run build:web
bun run scripts/v3/qa.ts
bun run scripts/v3/worker-qa.ts
bun run scripts/v3/verify-final.ts
```

`qa.ts` seeds actual local gifts/transfers and a persistent practice season, verifies authorization, and checks all five pages at 1600px and 390px. `worker-qa.ts` deliberately advances only the local chain to test a weekly sweep. `verify-final.ts` funds and cancels a sponsor commitment through the public gift page and checks current league scores. These scripts are intended for the isolated test chain.

Validation at delivery: 131 passing contract tests (including 24 new expansion tests, one with 256 fuzz runs), 341 server tests, 221 web tests, TypeScript checks and production web build. One existing optional fork test is skipped without its external RPC. The existing main-app bundle-size warning remains; the new expansion route is separately loaded. The worker contributed exactly 452 cents from five real test transfers, with every journal entry reconciled to one successful sweep. Final videos decode successfully and contain 900 frames each: H.264, 1920×1080, 30fps, AAC instrumental audio, 30 seconds.

## Deployment configuration

The expansion is off by default. Enabling a deployment requires:

- `SPROUT_V3_ENABLED=true` and a persistent random 32-byte hex `SPROUT_V3_DATA_KEY`.
- `SPROUT_V3_FACTORY`, `SPROUT_V3_MATCHING`, `SPROUT_V3_ROUNDUP_MODULE`, `SPROUT_V3_EVENT_BOOK`, and `SPROUT_V3_EXECUTOR` addresses.
- The normal chain, settlement, admitted asset/venue, indexer and keeper settings. The active normal factory should be the new V3 factory; retain previous deployments in the existing legacy-deployment configuration.
- The existing keeper requires a signer and all four positive gas-budget settings before it sends anything. The executor address must match that signer for round-up sweeps.
- `SPROUT_V3_AUTO_PARK=true` enables the optional background cash sweep. It also requires the vault owner's onchain cash-parking consent, current eligibility/NAV policy and an available treasury. The worker keeps one scheduled investment liquid. Automatic parking is off in the film fixture, where the parent chooses amounts manually.
- Individual `SPROUT_V3_EVENTS`, `SPROUT_V3_ROUNDUPS`, `SPROUT_V3_ARENA`, `SPROUT_V3_CASH`, and `SPROUT_V3_CONTINUITY` flags can be set to `false`.

Deploy `MatchVault`, `RoundupModule`, the optional `EventBook` hash registry, and the opt-in `SproutV3Vault` implementation; then create a factory using that implementation. The event UI uses encrypted metadata and the vault's onchain gift reference/receipts; `EventBook` is a separate hash-registry contract, not the source of guest-wall content. A treasury-enabled implementation needs a compatible, approved ERC-4626 vault and its `TreasuryPolicy`; a cash-fallback implementation uses zero treasury and policy addresses. `LocalTreasury` is a test-only contract and refuses non-31337 deployment. No public-chain deployment was performed.

Private records participate in the existing family-data erasure flow, including celebration lookups and league membership. Minimal transaction references remain without an owner association to prevent replay. Keep the data key stable; key rotation requires re-encryption. Public sponsor history retains commitment IDs so unused escrow can be recovered after active matching slots are reused; the public checkout also accepts a known commitment ID for recovery.

The equity practice calendar uses the [NYSE 2026 calendar](https://www.nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf), fails closed outside its supported year, and treats the configured BTC/ETH wrappers as continuous markets. Fills require available prices and use a documented 10-basis-point modeled spread. Treasury accounting uses the existing [OpenZeppelin ERC-4626 implementation](https://docs.openzeppelin.com/contracts/5.x/erc4626), with eligibility and a freshness gate supplied by the separately configured operator.

## Recordings and delivery

```sh
bun run scripts/v3/capture.ts
python3 scripts/v3/render.py
python3 scripts/v3/package.py
```

Capture requires the local seeded stack and Playwright/Chrome. The render/package scripts use `imageio_ffmpeg`, plus the existing local Remotion compositor's `ffprobe`; adjust those tool paths when reproducing on another machine. The instrumental score is the existing original synthesized Sprout score, copied to `output/v3/audio/score.wav`. `V3_CAPTURE_ONLY` and `V3_RENDER_ONLY` support targeted retakes. No voice source is used, and no API responses are mocked in the recordings.

Delivered files are in `~/Downloads/SPROUT - V3 Expansion Videos/`: five MP4s, a combined ZIP, a local watch page, posters, license and video metadata. Source recordings, screenshots and verification reports are in ignored `output/v3/`. Public sponsor funding/refunding was verified in addition to the filmed family workspace. The Continuity recording shows plan editing, check-in and reserve funding; successor activation, cancellation and early-graduation boundaries are covered by the contract tests.
