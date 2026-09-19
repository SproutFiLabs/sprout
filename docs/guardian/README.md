# Sprout Guardian

Guardian is a separate, opt-in beneficiary smart wallet for newly planted sprouts. The existing SproutFactory and SproutVault contracts are unchanged. A parent selects the deployed Guardian address as the beneficiary. Rewards and graduated withdrawals enter Guardian, whose outgoing transfer policy applies afterward.

The current owner is chosen at deployment. Guardian does not silently turn a parent-owned account into a child-owned one at graduation. Choose the intended beneficiary's owner wallet at enrollment. After graduation that owner can select their own guardian circle using the delayed policy flow. Existing sprouts have fixed beneficiaries: this release neither migrates nor upgrades them.

## Enforced behavior

- P-256 WebAuthn approvals for bounded transfers, queued transfers, allowance claims and graduated withdrawals. Every assertion includes wallet, chain, epoch, nonce, action, target, token, amount and a deadline. User presence AND verification, RP-ID, origin, ceremony type and challenge are checked. OpenZeppelin 5.1 P256 verification uses the native precompile when available and its Solidity implementation otherwise. Synced credential counters and attestation are not used.
- Three distinct guardians, separate from the owner. Recovery starts with one guardian and requires a second independent approval. The 48-hour delay starts at quorum; the third approval cannot shorten or restart it. The current owner can cancel. A quorate live recovery blocks outgoing transfers.
- Recovery replaces the owner and advances a security epoch. Old passkeys, trusted destinations, pending transfers and pending policy changes become invalid. The new owner's address becomes the initial trusted destination. The budget's existing spend is retained until its normal reset.
- All owner and passkey instant transfers require a trusted recipient and the token-specific 24-hour budget. The window begins with the first instant spend after the previous window expires. It is not a sliding-window maximum. Budget is denominated in the token's units, not a fiat valuation. Native ETH starts with zero instant budget.
- Every new-destination or over-budget outgoing transfer must be queued for at least 24 hours. The owner or ANY guardian can cancel. Anyone can execute the exact queued transfer after the delay and within seven days. Queued transfers are deliberately not constrained by the instant budget after their delay.
- Increasing budgets, adding trusted recipients or changing guardians requires an exact policy commitment and 48 hours. Existing guardians can veto it. Tightening a budget or untrusting a destination is immediate for the owner. Changing the guardian set invalidates pending recovery votes. Delays and the 2-of-3 quorum are not configurable.
- Owner or any guardian can revoke a passkey. Revocation disables the credential, including synced copies, not a particular physical phone. Up to 64 credentials per recovery epoch; expiry is at most one year. An owner wallet is still required for device enrollment and policy management.
- The owner can use a normal contract tool without the website. There is no proxy, upgrade admin, arbitrary execution, ERC-20 approve, delegatecall, bundler, paymaster or server-held signing key. A connected wallet pays gas for a passkey-authorized transaction. This release is not ERC-4337 and does not sponsor gas.

## Trust and limits

This is new unaudited wallet code, not a claim of an independent audit or guaranteed physical safety. Two colluding guardians can obtain control after the delay if not cancelled. A malicious current owner can cancel legitimate recovery. Any guardian can repeatedly veto queued transfers and policy changes or revoke credentials: choose guardians carefully. Compromise of the owner or an active passkey permits spending up to the instant budget and scheduling delayed transfers. The review window only helps if someone notices and cancels unwanted requests. There is no automatic notification delivery in this release.

Passkeys are tied to the enrollment RP/domain. Losing that domain can prevent passkey ceremonies; owner-wallet transactions and guardian recovery remain available. Recovery requires reachable guardians and network gas; it cannot recover access if all relevant keys are lost. Passkeys do not conceal public addresses or relationships. Wallet deployments, guardians, budgets, transfers and recovery activity are public on-chain.

The UI compares deployed runtime bytecode (masking only the compiler-declared RP-ID immutable) with the published artifact, then reads a coherent block snapshot. It does not accept a VERSION getter alone as proof of wallet identity. Assets listed in the app use their configured decimals; unknown queued tokens show raw units.

## Reproduction

```
forge test --root contracts
forge build --root contracts
bun scripts/gen-guardian.ts
bun run typecheck
bun --cwd web test
bun --cwd server test
bun run --cwd web build
```

`scripts/guardian-smoke.ts` requires a local Anvil chain (31337) and the local API config. It rejects public RPC hosts and other chain IDs. It deploys an isolated wallet, generates a real P-256 key and WebAuthn-shaped signed assertion, exercises budget/replay/quorum/delay/recovery behavior and writes public state snapshots under ignored `tmp/guardian-smoke`. No private key or family data is persisted. Default ports are 28547 (Anvil) and 4327 (API); override with GUARDIAN_TEST_RPC/GUARDIAN_TEST_API. It advances LOCAL chain time.

The native browser passkey enrollment still requires the user's authenticator interaction. Automated contract tests and the cryptographic smoke test do not constitute a physical-device compatibility audit.
