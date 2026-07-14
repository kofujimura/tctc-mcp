# TCTC Dashboard

A human-facing management dashboard for [ERC-7303](https://eips.ethereum.org/EIPS/eip-7303) (Token-Controlled Token Circulation) roles. Where [tctc-mcp](https://github.com/kofujimura/tctc-mcp) exposes on-chain roles to AI agents, this dashboard exposes the same on-chain state to the humans who manage them — two clients of one source of truth: the chain.

A role is a token. **Grant is a mint. Revoke is a burn.** This page makes that visible and clickable.

## What it does

- **Inspect any IERC7303 contract** — verifies ERC-165 support (interface id `0x4ee69337`), then discovers the role structure from the contract itself via `getERC721ControlTokens` / `getERC1155ControlTokens`. Nothing is configured; the contract is the source of truth.
- **Role discovery without an archive node** — common role names (`MINTER_ROLE`, `BURNER_ROLE`, …) are probed in a single Multicall3 round-trip; any other role name can be added by hand (or a raw 32-byte role hash).
- **Check any subject** — an agent wallet, an ERC-6551 TBA, a user address. Shows the target's own `hasRole()` verdict plus the per-control-token `balanceOf` evidence behind it, live-refreshing every 12 seconds.
- **Issuer actions** — when the connected wallet is the `owner()` of a control token, Grant (mint) and Revoke (`burnByIssuer`, the kill switch) buttons appear inline. For `ExpiringControlTokens`-style contracts (detected by `expiresAt()`), grants are timed and a countdown is shown; expiry revokes the role gaslessly with no further transaction.
- **Shareable URLs** — `?chain=sepolia&target=0x…&subject=0x…` restores the whole view.

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
