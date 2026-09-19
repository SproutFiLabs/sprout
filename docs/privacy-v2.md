# Privacy v2: implementation and remaining integrations

This branch implements six **local preparation workflows**, public venue discovery and two non-custodial registries. It does not complete the shielded financial system requested by the Privacy v2 brief. Do not advertise these workflows as live private swaps, automated gifts, shielded savings, proof-enforced parental controls, holdings proofs or ZK solvency proofs.

## Available in the branch

`/privacy-workspace` uses Sprout’s landing-page brand assets and typography. It supports:

- Encrypted order intents bound to a saved family-policy hash. The client checks the selected asset and dollar order limit. Quantity is in token base units and price in micro-USD; these intents are not Darkpool calldata.
- Fresh secp256k1 destinations with separate spending/viewing keys and recipient key recovery. This version’s explicit shared-point encoding is named `sprout-stealth-v1`; ERC-5564 interoperability has not been certified. The alias is local, not a registered public tag. Ordinary transfers would still reveal amounts and timing.
- Gift allocation plans in USD cents, using deterministic largest-remainder allocation to preserve every cent. No token conversion is submitted.
- Adult savings plans in USD cents with daily, weekly or 30-day cadence. No recurring job is scheduled.
- Versioned family-policy commitments, approved assets, order value and concentration limits. A separate advisory preflight validator rejects expired, stale, paused, overweight and adult-only orders; authenticated portfolio values must eventually come from a verified state root. Local validation is not cryptographic settlement enforcement.
- Audience-bound holdings/membership/solvency requests with fresh challenges and short expiry. Requests are not proofs. The user must supply the appropriate verifier and state root; the Darkpool order verifier is not a holdings verifier.

Keys and plans stay in a WebCrypto AES-GCM workspace. A 600,000-iteration PBKDF2 passphrase wraps the workspace key. Backups contain ciphertext. Wrong passwords and modified ciphertext fail authentication. Lock clears visible fields, decrypted state and the in-memory key; five minutes in a hidden tab also locks. JavaScript strings cannot guarantee memory zeroization. XSS, compromised devices and extensions remain outside this protection.

`TagRegistry.sol` supports EIP-712/EIP-1271 authorized, versioned key updates, expiry and revocation without expiry-based tag takeover. It holds no funds. It checks key encoding length/prefix, not curve membership; clients validate curve points. Controller and guessable tag hashes are public. Do not associate a child’s name or existing family wallet with a tag controller.

`SproutPolicyRegistry.sol` binds account identifiers to controller, salt, chain and registry. Policies support epoch checks, expiry and revocation. It is a commitment registry, not a private-trade verifier. Neither new registry is deployed.

## Public integration verified

The user chose public integrations only. `GET /api/privacy/venue` reads Darkpool’s public `/api/pool` endpoint, fixes the expected pool and chain, and checks pool bytecode, order-verifier bytecode, window length, token allowance and token decimals against one Robinhood Chain block. It caches a successful inspection for 60 seconds. No private wallet data, credentials, approvals or transactions are sent. Public token symbols originate from the provider; those labels are not authenticated by token contracts.

Run `bun run scripts/check-privacy-venue.ts` for a fresh public snapshot. A successful snapshot proves availability and metadata consistency, not an audit or family safety. The request returns 503 if checks fail. Financial v2 routes always return JSON 404, including when the SPA is served.

Inspected 2026-09-19 at block 66877939:

- Pool: `0xFCa786642cEeB58F4cC1543B5d7FC91cdD254B93`
- Runtime hash: `0x737843445043b1af2910a85f76845787f7207e9e98b8b23db0b2c47c1015f9f8`
- Order verifier: `0x0B34803A4642da979c1daeC0e888Af41A130d6C6`
- Order-verifier runtime hash: `0x235b9c136749e35d69b27016e47e835ae5a0603b4b880886d592e07126ca6bda`
- Five markets: AAPL, AMZN, MSFT, NVDA, TSLA; 300-second windows.

## Gaps in the supplied brief

The brief assumes existing reusable circuits and deployed services. Inspection did not substantiate all those assumptions:

1. [Darkpool OrderValidity](https://github.com/DarkPoolFi/DarkPoolFinance/blob/ee0d622f114fe6b5aef1f732bc73a159749811bc/circuits/order_validity/src/main.nr) authenticates a note and order but has no Sprout policy hash or parental allocation-cap input. A new circuit and enforcement boundary are required; adding a client check or another public hash does not enforce rules in the pool. A parent-authorized private-vault design must prevent direct bypass of the Sprout wrapper.
2. [Tagio PrivateSendPool](https://github.com/TagioFi/Tagio/blob/d2108e33c5b399bc49f3e028d0fda56f1901d26b/contracts/src/PrivateSendPool.sol) explicitly describes its protection as casual privacy. Public amount and timing correlation remain possible. It is not the shielded tag-payment engine assumed by the brief.
3. No usable Hood USDP/Veil join-split, VeilV3 holdings, or ZK solvency source/deployment/audit package was found in Sprout or the public repositories inspected. Darkpool describes an hourly **signed** solvency report, which is not the brief’s requested ZK solvency proof.
4. Existing Sprout vaults are immutable and graduation-locked. Introducing another vault type cannot imply funds have migrated or bypass their existing restrictions.
5. Production graduation and backup-restore verification remain incomplete. They are mandatory launch conditions in the brief and existing repository documentation.

## Remaining work before financial release

Specify and implement the policy-aware shielded account/note transition; compile and validate the new circuits; connect real public proving/settlement and relaying; test self-relay and exits; implement consented family viewing-key disclosure and encrypted receipts; complete tag resolution, rotation and shielded gifting; implement actual adult accounts/DCA and advanced order types; connect real holdings/membership/solvency verifiers; build the separate privacy indexer and workers; run adversarial proof, graph correlation, payload/log leakage and end-to-end transaction tests. Verify the production graduation and restore gates before enabling routes.

This branch does not add a database, paid hosting service, environment flag that pretends a verifier is ready, or a money-moving contract. Existing family savings behavior is preserved.

## Validation

- Shared protocol and browser tests cover invalid policies, expiry, allocation conservation, challenge binding, destination recovery, wrong passwords, tampered ciphertext and exact amount precision.
- Contract tests cover signed tag updates, replay across versions/contracts/chains, expiry, takeover prevention and policy authorization/versioning.
- API tests assert disabled v2 routes remain 404 through the SPA fallback.
- Browser verification completed all six local save workflows and an over-limit order rejection. Checked desktop and 390px mobile layouts; no horizontal document overflow on mobile.
- Public venue check executed against Robinhood Chain; no transactions or approvals submitted.

The six 30-second videos illustrate these local workflows with the actual website component. Their captions identify the preparation/settlement boundary. They are not evidence of shielded transaction execution.
