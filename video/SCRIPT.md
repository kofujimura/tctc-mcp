# TCTC Teaser — Shooting Script (60–90 s)

Core message: **"The human burns a token; the agent instantly loses the
capability. No permission server."**

All on-screen material is secret-free: the agent config uses a public
Sepolia RPC; admin keys live only in environment variables off-screen.

## Scene plan

| # | t (s) | Scene | Source | Status |
|---|---|---|---|---|
| 1 | 0–8 | Title card: "Your AI agent has too much power." → "Here's the kill switch." | `web/title.html` via Playwright | automated |
| 2 | 8–28 | Agent side: Claude Code asked "mint a demo NFT"; calls `check_role` → true; mints; tx confirmed | **live screen capture** (QuickTime) — placeholder `tapes/02-agent.tape` in the draft | manual |
| 3 | 28–42 | Principal side (terminal): `revoke_role MINTER_ROLE` → burn tx hash. Caption: "No server. No API-key rotation. One transaction." | `tapes/03-revoke.tape` (VHS, real tx) | automated |
| 4 | 42–58 | Etherscan: the burn tx (TransferSingle → 0x0) on screen | `record-etherscan.mjs` (Playwright) | automated |
| 5 | 58–75 | Agent side again: same request; `check_role` → false; agent declines. In the draft: `tapes/05-denied.tape` shows `check_role` false + on-chain revert | live capture (final) / VHS (draft) | both |
| 6 | 75–85 | Closing card: "Roles are tokens. ERC-7303 × MCP" + repo URL | `web/closing.html` | automated |

## Live scene prompts (for the manual Claude Code recording)

Agent session (this repo, `.mcp.json` auto-loads the read-only server):

1. Scene 2 — type: **"Mint a demo NFT for me. Check first whether you
   have the required on-chain role."**
   Expected: `check_role(MINTER_ROLE)` → `hasRole: true`, then the mint
   (via the hardhat mint script or tctc-call) succeeds.
2. Scene 5 — type the same sentence again after the revoke.
   Expected: `check_role` → `hasRole: false`, agent explains it no
   longer holds MinterCert and refuses.

Recording tips: Cmd+Shift+5 → record selected portion (agent terminal
only); 60 fps not required, 2× zoom on the tool-call output after the
fact.

## On-chain state choreography

The tapes execute real Sepolia transactions. Required order:

```
(start: subject has no MinterCert)
tapes/02-grant.tape   → grant  (draft stand-in for scene 2; final video: live mint)
tapes/03-revoke.tape  → revoke (scene 3)
tapes/05-denied.tape  → check false + revert demo (scene 5)
```

`video/render.sh` runs everything in this order and is idempotent:
it grants first, so it can be re-run for retakes.

## Build

```bash
# prerequisites: brew install vhs; npx playwright install chromium
set -a; source <admin env>; set +a     # TCTC_ADMIN_PRIVATE_KEY, E2E_SUBJECT
video/render.sh                        # renders tapes + etherscan + titles
video/compose.sh                       # → video/out/teaser-draft.mp4
```
