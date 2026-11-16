# TCTC Dashboard

A human-facing management dashboard for [ERC-7303](https://eips.ethereum.org/EIPS/eip-7303) (Token-Controlled Token Circulation) roles. Where [tctc-mcp](https://github.com/kofujimura/tctc-mcp) exposes on-chain roles to AI agents, this dashboard exposes the same on-chain state to the humans who manage them — two clients of one source of truth: the chain.

A role is a token. **Grant is a mint. Revoke is a burn.** This page makes that visible and clickable.

## What it does

- **Overview — people and the tokens they hold** — the first screen shows only who holds what. On top, **you** (the connected wallet): a round avatar and the credentials you hold, drawn as landscape certificates. Below, **your agents**: each AI agent is an EOA with a robot avatar, and the control tokens it holds are drawn as portrait passes. Every card names its issuer (the collection's `owner()`) with an icon and a colour — you, an employer, a government body, a manager, another AI agent — and lists what the token opens on the watched targets, read live every 12 seconds. Grants animate in; a revoke stamps the card “burned”; an expiring grant counts down and turns “expired” with no transaction. If your wallet issues a collection, you can grant to / revoke from an agent right on its card.
  - **Manage** holds everything that is typed rather than looked at: the agent roster, the watch lists, the target inspector, deployment, and the names shown on the cards. The chain knows which account issued a token, not that it is your employer, so issuer names and kinds, token titles and avatars (a generated robot, or your own image) are labels kept in this browser's `localStorage`, like contacts. They change nothing a target enforces.
  - **Story mode** — `?story=ica2026` replays a scripted scenario through the same cards, for talks and screen recordings: one person, one agent, one token accepted by four applications, an expiry with no transaction, and one burn that closes everything. Arrow keys step through the scenes, `h` hides the caption bar, `&scene=3` starts at a scene, `&theme=light|dark` pins the colours. With `&live`, `&ghost=60` keeps a burned card on screen for that many seconds (20 by default). Nothing is read from a chain, and the header says “Story mode · sample data”. `?story=ica2026-wide` is a larger tableau with every kind of issuer. Adding `&live` (`?story=ica2026&live`) shows the same story from its real Sepolia deployment instead: tokens, issuers, expiry and bindings are read from the chain, only the captions and the agent's status line stay scripted, and the header says “Live on Sepolia · status lines scripted”. [demo/ica2026](../demo/ica2026/README.md) holds that deployment and the commands that drive its scenes. The scenes are explained in [docs/ICA2026_TALK_SCENARIO.md](../docs/ICA2026_TALK_SCENARIO.md) and defined in `src/lib/story.ts`.
  - **Binding an agent**: start tctc-mcp in the agent's folder with `TCTC_AGENT_PRIVATE_KEY` in `.env.local` (`npx tctc-mcp agent init`). It prints a link — `?chainId=…&agent=0x…&name=…&ts=…&sig=…` — signed by the agent key (EIP-191). Opening it adds the agent as **key-verified**; the key never leaves the agent. Agents can also be added by address (shown as unverified).
  - The roster is kept per chain in this browser's `localStorage`; everything else is read from the chain. Tokens are found without an indexer: ERC-1155 `balanceOfBatch` over typeIds 0–31 plus every typeId bound on a watched target, ERC-721 `balanceOf`. Watched targets = the Sepolia demo targets + every target you inspect; watched collections = the demo collections + every control token bound on a watched target + collections you deploy or load.
- **Inspect any IERC7303 contract** — verifies ERC-165 support (interface id `0x4ee69337`), then discovers the role structure from the contract itself via `getERC721ControlTokens` / `getERC1155ControlTokens`. Nothing is configured; the contract is the source of truth.
- **Role discovery without an archive node** — common role names (`MINTER_ROLE`, `BURNER_ROLE`, …) are probed in a single Multicall3 round-trip; any other role name can be added by hand (or a raw 32-byte role hash).
- **Check any subject** — an agent wallet, an ERC-6551 TBA, a user address. Shows the target's own `hasRole()` verdict plus the per-control-token `balanceOf` evidence behind it, live-refreshing every 12 seconds.
- **Issuer actions** — when the connected wallet is the `owner()` of a control token, Grant (mint) and Revoke (`burnByIssuer`, the kill switch) buttons appear inline. For `ExpiringControlTokens`-style contracts (detected by `expiresAt()`), grants are timed and a countdown is shown; expiry revokes the role gaslessly with no further transaction.
- **Shareable URLs** — `?chain=sepolia&target=0x…&subject=0x…` restores the whole view.
- **Issue control tokens** — deploy your own soulbound certificate collection straight from the
  browser wallet (standard, or auto-expiring with timed grants), then grant/revoke on it
  directly — no target contract needed to start operating. This is the innermost layer of the
  TCTC onion: issuance governed by `onlyOwner` alone; outer layers (token-gated issuance) can
  be added later. The deployed bytecode is byte-identical to the Etherscan-verified reference
  deployments, so explorers auto-verify each new deployment by similar-bytecode match. Note:
  binding a new collection to an *existing* target requires that target to expose a
  binding-admin function — new targets bind at deploy time; one collection can control many
  targets.

## Try it (Sepolia)

```sh
npm install
npm run dev
```

Then open, for example:

- `?target=0x873f0bf314A1e0B566015CEf9dA37783A729Fd02` — MyComplexToken: three roles, OR-composition, ERC-721 + ERC-1155 control tokens
- `?target=0x3eAb11DE9655817A2e2977A486d9D33eBD10c9Ce` — unmodified demo target whose roles auto-expire via ExpiringControlTokens
- `?target=0xa52fe39D0de852e88488faa34e723E861D0b09BD` — a legacy contract that gates identically but does not declare IERC7303 (negative case)

`npm run build` emits a fully static site in `dist/` (deployable to GitHub Pages, Vercel, etc. — `base` is relative).

### Deploying to Vercel

Import the repository in Vercel and set **Root Directory** to `dashboard/`. The included `vercel.json` declares the Vite framework preset (build `npm run build`, output `dist/`) and an SPA rewrite; no other settings are needed.

## Security model

- Reads go to a public JSON-RPC endpoint (overridable in Settings). No API keys, no backend, no database.
- Writes are signed by **your** browser wallet only; the page holds no private keys.
- The dashboard is advisory like any client: the enforcing check is the ERC-7303 modifier on-chain. A revoked role fails on-chain regardless of what any UI or agent believes.
