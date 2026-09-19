# Sprout Spend

`/spend` adds a Sprout-native gift-card shop, parent approval, a USDC-on-Base invoice/payment step, private order history and a masked redemption screen. Navigation is available from the landing page Explore menu and dashboard. This release does not withdraw from children’s savings, accept SPROUT directly, swap or bridge assets, or implement phone refills/eSIM checkout.

## Activation

Purchasing is disabled by default. There is no production fixture mode or fake success path. Configure the following on the server only:

- `SPROUT_SPEND_ENABLED=true`
- `BITREFILL_API_KEY`: personal account Bearer key; or `BITREFILL_API_ID` / `BITREFILL_API_SECRET` for Business API Basic authentication. The Bearer key takes precedence when both are set.
- `SPROUT_SPEND_PRODUCT_IDS`: comma-separated, vetted product IDs

Products must be in stock, US-region, USD-denominated, require no recipient data and have supported whole-dollar denominations at or below $100. The initial catalog is deliberately curated; unsuitable categories should never enter this allowlist. Personal keys support account purchases and catalog access. Bitrefill recommends Business API access for platforms/resellers; successful authentication alone does not establish approval for public resale. Account signup and email verification are complete; a controlled real end-to-end purchase and the public fulfillment arrangement remain outstanding. The public docs have inconsistencies (for example package arrays vs objects and redemption string vs object); the adapter supports the documented guide shape and fails closed on unrecognized payloads. The personal key was verified against `/ping` and live US Steam/Nintendo product responses on 2026-09-19. Invoice and redemption payloads still require end-to-end verification before public activation. Local development can load the ignored, owner-only `.env.spend.local` with `bun --env-file=.env.spend.local server/src/index.ts`. Never use a `VITE_` variable for this key.

Provider references consulted 2026-09-19:
- https://docs.bitrefill.com/docs/api-overview
- https://docs.bitrefill.com/docs/integration-flow
- https://docs.bitrefill.com/docs/crypto-payments
- https://docs.bitrefill.com/reference/post_invoices
- https://docs.bitrefill.com/reference/get_invoices-id
- https://docs.bitrefill.com/reference/get_orders-id

The wallet pays the provider invoice directly using canonical Base USDC. Checkout, approval and status remain on Sprout. Bitrefill fulfills the purchase; merchant redemption may occur on the merchant’s site. This integration does not make Sprout the gift-card issuer. No merchant partnership or availability is implied by film fixtures. Token conversion from Robinhood Chain requires separate liquidity/routing work and validation.

## Authorization and payment lifecycle

The existing family session protects every order read. A parent wallet must sign a nonce whose purpose hashes the canonical request (unique key, vault, product, amount, region). The server independently authorizes that vault’s parent, checks the curated product and applies a $100 order/$200 rolling-24-hour checkout limit. The latter counts all created invoices, including expired ones, conservatively preventing retry loops from increasing permitted spending. Limits cover these Sprout checkouts only, not the parent’s entire wallet.

A SQLite reservation precedes invoice creation. Retries with the same owner/key return the saved order; signature replay fails. An ambiguous provider creation timeout persists as `attention` and blocks further checkouts for that owner until manually reconciled. The server never spends a Bitrefill platform balance and never retries invoice creation automatically.

Before a wallet transfer, the client rechecks account, network, exact USDC address, quote window and provider status. A server-side payment-attempt flag prevents a second UI payment across tabs/reloads. An explicit wallet rejection (4001) releases that flag; ambiguous RPC failures retain it. This flag prevents accidental duplicate checkout attempts, not arbitrary transfers from a wallet controlled by its owner.

The three-minute payment window is a conservative local cutoff, not a claimed provider expiry. Provider state is rechecked before signing. Later provider payment/delivery confirmations still reconcile after that cutoff. `delivered` requires invoice completion plus a delivered order whose invoice/order IDs match. Codes are fetched on demand, never stored in SQLite, and hidden until revealed. No child name, email, gift message or vault address is submitted to the fulfillment provider; the payer refund address and purchase details are shared. On-chain payments remain public.

## Recovery

If creation times out, do not create another invoice. Using the Business dashboard, an operator must determine whether an invoice exists and associate its verified ID with the saved Sprout order before resuming polling. Keep the original row/audit evidence. Never delete rows or reset the payment flag merely because the UI is slow. Reconcile provider refunds, blocked orders and payment errors through provider support. This initial release does not automate refund issuance or expose a browser admin reconciliation endpoint.

## Film

`scripts/spend-film` contains the reproducible source for the 30-second render at `output/sprout-spend-film/out/SPROUT-Spend.mp4`, rendered from a copy of the actual `SpendView.tsx` and CSS, using isolated staged merchant, quote and receipt data. No live purchase was made. There is no production URL/query parameter that injects those fixtures. The delivered MP4 intentionally has no demo/simulation watermark per user direction. Identify it as a staged product walkthrough when sharing; do not claim the account or fulfillment integration is live until approved and verified.
