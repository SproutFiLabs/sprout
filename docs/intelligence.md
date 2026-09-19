# SPROUT Intelligence

`/intelligence` is a parent-focused AI learning space that shares the landing page’s botanical artwork, typography and colors. It is linked from the landing page, dashboard and resources menu. Visitors can explore clearly labeled, authored example conversations. Eligible holders can verify a wallet and ask live questions when the server has an AI key configured.

## Holder access

- Network: **Robinhood Chain mainnet, chain ID 4663**.
- Token: **`0x5ec27c931fb49911128dddf7d914c1754da9f49f`**.
- Minimum: **1,000,000 SPROUT**, inclusive. The contract reports 18 decimals; the implementation reads decimals and compares integer base units without floating-point rounding.
- Wallet ownership requires a signed, expiring, single-use challenge for the `intelligence` purpose. No transaction, staking, token transfer or spending approval is requested.
- The server checks its RPC’s chain ID, requires a recent block, and reads the fixed token’s balance and decimals at that block. It repeats verification before every AI request. Insufficient holdings or an unavailable/stale RPC block access.
- Sessions expire after 15 minutes. Account/network changes and disconnects clear the browser’s conversation and session. Only a hash of the session token is stored in SQLite.

The public RPC and chain details are documented by [Robinhood Chain](https://docs.robinhood.com/chain/add-network-to-wallet/). Intelligence has its own RPC configuration; the vault network setting does not decide token eligibility.

## Enable live answers

The default configuration can verify holdings on Robinhood Chain. **An OpenAI API key is still required for live answers.** Add it to the API server’s environment, never to a `VITE_` variable, the frontend, or a committed file. Restart the server after configuring it.

```dotenv
SPROUT_INTELLIGENCE_CHAIN_ID=4663
SPROUT_INTELLIGENCE_CHAIN_NAME=Robinhood Chain
SPROUT_INTELLIGENCE_RPC_URL=https://rpc.mainnet.chain.robinhood.com
OPENAI_API_KEY=<configure securely on the server>
SPROUT_INTELLIGENCE_MODEL=gpt-4.1-mini
SPROUT_INTELLIGENCE_DAILY_LIMIT=40
SPROUT_INTELLIGENCE_GLOBAL_DAILY_LIMIT=500
```

`GET /api/intelligence/config` exposes readiness flags, the public access rule and wallet daily allowance. It never exposes the API key or RPC URL. A readiness flag means configuration is present; it does not guarantee upstream availability. Missing credentials and provider failures produce explicit unavailable states, never simulated AI replies.

The integration uses OpenAI’s Responses API with `store: false`, a 35-second timeout and a 900-output-token limit. By default each wallet gets 40 requests per UTC day and six per minute; the server accepts up to 500 requests per UTC day across all wallets. One request per wallet may be in flight. Quotas persist in the existing SQLite database across new sessions and restarts; failed provider attempts also count. These are **request limits, not a hard dollar cap**. AI usage is billed to the configured provider account; holder access has no subscription charge. No new hosting service is needed.

## Guidance and privacy

Intelligence is for general education: understanding terms, discussing trade-offs, family money lessons and preparing questions for a qualified professional. Its instructions prohibit personalized asset recommendations, promised returns, executing transactions and encouraging token purchases. Every answer includes **“For education and information only. Not financial advice.”** Model instructions are not a guarantee that an answer will be correct or appropriate. There is no live browsing or access to a family’s portfolio.

The server does not save chat transcripts. The browser keeps the conversation in memory and sends its bounded history with each question. Refresh, disconnect, session expiration or a fresh conversation clears it. OpenAI receives the messages for generation and its own data retention policies apply; `store: false` is not a claim of zero provider retention. Wallet/session records and request counters are stored separately. Avoid child-identifying information, account details and wallet secrets in prompts.

## Validation

```sh
bun run typecheck
forge build --root contracts
bun test server/test web/test
bun run build:web
```

The Intelligence tests cover exact thresholds, signed ownership, replay protection, expiry, balance changes, provider/RPC failures, request validation, quotas and provider request shape. RPC and AI adapters use controlled fixtures in automated tests; these are not live model evaluations. Validate the configured provider and a consenting eligible wallet before enabling this in production.
