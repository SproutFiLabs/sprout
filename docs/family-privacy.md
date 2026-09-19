# Family privacy update

This update closes Sprout's anonymous application-level family reads and identity-bearing kid links. It does **not** hide the existing public contracts, wallet relationships, balances, transactions, or historical gift references. It is not a guarantee against physical targeting.

## Working behavior

- Wallet nonce authentication exchanges a single-use signature for a 30-minute family read session. Only the authenticated parent or beneficiary can read a vault, including the new Invest now quote route. Listing another address's family is denied. Sessions live in browser memory; only their hashes are stored by the server. Locking family sessions revokes all read sessions for that signer.
- Parents create one-use kid invitations. The URL contains a random invitation ID and a fragment secret, with no name or wallet address. The browser removes the fragment before loading the view. The invitation expires after seven days; a redeemed device session lasts at most 24 hours and is revocable. The server returns a separate minimal DTO. Kid credentials never authorize family reads or mutations. Amounts are hidden by default and require explicit parent opt-in. An already rendered view clears on its next poll (15 seconds) or reload after revocation; revocation cannot erase screenshots or previously seen information.
- Private names, chore titles, favorite IDs, gift labels and campaign titles live in an encrypted browser vault. AES-256-GCM uses random 96-bit IVs and authenticated owner/context identifiers. A random 256-bit vault key is wrapped using PBKDF2-SHA256 (600,000 iterations) and a passphrase; it is never persisted in plaintext. Recovery uses an encrypted backup plus either the passphrase or a separately saved recovery key. Only legacy labels for the connected parent’s listed sprouts are migrated; unrelated device labels remain for their owner. Legacy local labels are removed only after encrypted persistence and a successful decrypt check. Labels lock after five minutes in a hidden tab, on account changes, or explicitly. Pending asynchronous operations cannot republish decrypted data after locking.
- Gift pages and social previews contain generic copy, no family labels, balances, progress totals or message wall. Signed checkout discloses the public destination required for the existing ERC20 payment. Gift IDs still occur in chain events and can be correlated.
- Parents can register their gift public key. New gift messages use a fresh AES-GCM key wrapped with RSA-OAEP-3072/SHA256, with the gift ID bound to both operations. Only ciphertext reaches the message endpoint. The corresponding private key stays inside the encrypted browser vault. Another family key or gift ID cannot open the message. Existing plaintext messages remain preserved behind family authorization; they are not retroactively encrypted. An existing registered gift key cannot silently be replaced: restore its original backup.
- Sensitive responses have no-store/noindex and no-referrer headers. Old wallet-address kid routes resolve to a retired-link screen. The privacy screen reports on-chain shielding as unavailable.

## Threat boundary and compatibility

Outcome: **fixed for the application-level exposure described above; on-chain privacy remains unimplemented.**

The broken paths were unauthenticated `/api/sprouts*` and `/api/jobs/:id` reads, kid URLs containing wallet/name data, and public gift DTOs/previews returning personal text. A shared middleware checks every sensitive GET before record/chain reads, including nested resources and job ownership. Kid authorization has its own scope and DTO. Existing parent mutation signatures and financial contracts are unchanged. Parent and beneficiary reads, gift receipt verification/idempotency, note moderation, schedules, allowance claims and graduation withdrawals remain functional.

This is application hardening, not an independent cryptographic audit. It does not defend against malicious code delivered by a compromised application origin, compromised devices, a recipient sharing an invitation, or recipients retaining information. The trusted server distributes the gift public key. Backups must be kept current after changing private labels. Losing both a usable passphrase/recovery key and the encrypted backup loses those private labels and gift messages; it does not change ownership of on-chain funds. Browser encryption requires a secure origin (HTTPS or localhost).

The supplied privacy brief references shielded pools, verifier circuits, stealth funding, FHE, key ladders, viewing-key scanning, relayers, selective disclosures and private solvency proofs. Their implementations/audits/deployments are absent from this repository. No simulated shields, improvised money-moving cryptography, silent asset migrations, or claims of on-chain anonymity were added. Those require a separately designed and independently reviewed contract integration.

## Verification

- `bun run typecheck`: passed.
- `bun run test:server`: 119 passed; includes unauthorized/foreign/parent/beneficiary reads, encoded paths, expiry, all-session lock, hashed tokens, minimized gifts, one-use child redemption, child write rejection, expiry and revocation.
- `bun run test:web`: 74 passed; includes encryption/recovery round trips, wrong-key/context/tamper rejection, distinct IVs, account-change/lock races and pending-message decryption after lock.
- `bun run build:web`: passed. Existing large-bundle and missing Satoshi font asset warnings remain.
- `forge build --root contracts`: passed, with existing timestamp lint warnings; no contract code changed.
- `bun run smoke`: passed on a separately spawned local Anvil chain. Covers plant, deposits, scheduling/keeper, Invest now previews/execution and stale-price denial, indexed gift receipts/idempotency, encrypted gift note storage/decryption and public omission, moderation, milestones, allowance claims and post-graduation withdrawal.
- `node scripts/privacy-browser-check.mjs`: passed against the isolated local preview, with no page errors. Covers sign-in, encrypted vault setup/restore, recovery unlock on initial setup, backup export, key registration, default-hidden kid balances, fragment removal, child access/revocation, mobile overflow, private gift creation and generic public gift preview. `CHROMIUM_PATH` can point at an installed Playwright-compatible Chromium binary.
- A fresh read-only security reviewer identified asynchronous key/message publication races, a retained recovery-key UI copy and a note-moderation decoding regression. Each was confirmed and corrected; race regressions were added.

No live funds were moved. No production deployment or database migration was performed. SQLite additions are idempotent tables applied through the existing database initialization.

## Showcase

`privacy-browser-check.mjs` captures the actual updated interface using an isolated sample family. `privacy-showcase.mjs` composes a 30-second 1920×1080, 30 fps film from those captures; FFmpeg is selected with `FFMPEG_PATH`. The final film includes an original synthesized ambient soundtrack. Generated captures, test backups and video files stay in ignored `output/privacy/`, outside source control. The film labels the sample build and explicitly states that on-chain balances and transfers remain public.
