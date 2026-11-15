# ICA 2026 demo: the talk's story on Sepolia

The dashboard's story mode (`?story=ica2026`) replays a script with made-up
addresses. This folder puts the same story on Sepolia, so the dashboard can
show it from chain state instead:

```
http://localhost:5173/?story=ica2026&live
```

In that view the tokens, their issuers, their expiry and what each one opens
are read from the chain every 12 seconds. Only the captions and the agent's
status line come from the script, and the header says so.

## The cast

| Who | Role in the story | Account |
|---|---|---|
| Acme Corp | the employer; issues the Employee ID and the timed pass | the deployer's own account |
| Mika Sato | the person; issues the delegation token to her agent | created by `setup`, key in `demo/ica2026/.env.local` |
| Kit | Mika's coding agent; holds tokens, sends nothing | created by `tctc-mcp agent init`, key in `demo/ica2026/kit/.env.local` |

Both key files are ignored by git. Addresses are in `deployment.sepolia.json`.

## What is deployed

| Contract | What it is | Issuer or deployer |
|---|---|---|
| Acme Staff Credentials | `AgentControlTokens`; type 1 is the Employee ID | Acme |
| Mika's Delegations | `DelegationTokens`; type 1 is "Release assistant" | Mika |
| Acme Production Passes | `ExpiringControlTokens`; type 1 is "Production access" | Acme |
| Project files, Agent memory | `AppTarget` for two MCP servers; `AGENT_ROLE` ← Mika's Delegations #1 | Mika |
| Summary API | `AppTarget` for a web API; `AGENT_ROLE` ← Mika's Delegations #1, `MEMBER_ROLE` ← Employee ID | Acme |
| Release registry | `ReleaseRegistry`; `record()` requires `AGENT_ROLE` ← Mika's Delegations #1 | Acme |
| Deploy pipeline | `AppTarget` for a web API; `OPERATOR_ROLE` ← Acme Production Passes #1 | Acme |

Three contracts are specific to this demo (sources in `contracts/`, to be
compiled next to `examples/contracts/ERC7303.sol`):

- **`AppTarget`** is the on-chain side of an application that is not itself a
  contract. It declares which token types satisfy each of its roles and
  nothing else; the application's enforcement point calls `hasRole()` on it.
- **`ReleaseRegistry`** is a contract whose one action is gated by the same
  token.
- **`DelegationTokens`** is `AgentControlTokens` with one more rule: `mint`
  also requires the owner to hold `ISSUER_ROLE`, bound to the Employee ID.
  The right to issue is itself a token. Burning needs no role, so stopping
  an agent never depends on a third party.

All eight contracts are verified on Sepolia Etherscan. `artifacts/` holds
their ABI and bytecode (solc 0.8.28, optimizer 200 runs, cancun).

## Driving the scenes

Run from the repository root. Each command sends one transaction and waits
for it; the dashboard picks the change up on its next read.

| Scene | Command | What happens on chain |
|---|---|---|
| 1 | `node demo/ica2026/demo.mjs reset` | Kit holds nothing |
| 2 | `node demo/ica2026/demo.mjs grant` | Mika mints "Release assistant" to Kit: four applications open |
| 3 | `node demo/ica2026/demo.mjs pass` | Acme mints "Production access" to Kit, valid 30 minutes |
| 4 | `node demo/ica2026/demo.mjs expire 60` | Acme moves that expiry to 60 seconds from now; it then lapses with no transaction |
| 6 | `node demo/ica2026/demo.mjs burn` | Mika burns "Release assistant": the four applications close |

`node demo/ica2026/demo.mjs status` prints who holds what and which
applications admit Kit.

Notes for recording:

- Scenes 5 and 7 change nothing on chain; press the right arrow in the
  dashboard for their captions.
- A transaction takes 12 to 30 seconds to be included, and the dashboard
  reads every 12 seconds, so a card changes up to about 40 seconds after
  the command starts. Give `expire` at least 45 seconds: an expiry that has
  passed by the time the transaction is included is refused.
- In scene 4 the agent's "Denied" status waits for the pass to lapse on the
  chain, not for the script's clock.
- To press "Revoke" in the dashboard instead of running `burn`, import
  Mika's key into a browser wallet and connect it.

## Setting it up again

`node demo/ica2026/demo.mjs setup` deploys whatever `deployment.sepolia.json`
does not list, funds Mika with 0.02 ETH if she has less than half of that,
and issues her Employee ID. It is safe to re-run. It rewrites
`dashboard/src/lib/deployment.ica2026.ts`, which the dashboard reads.

Keys are read, never printed. The issuer's key is
`ICA2026_ACME_PRIVATE_KEY`, else `WALLET_PRIVATE_KEY`; they are looked up in
the environment, then `demo/ica2026/.env.local`, then the file named by
`ICA2026_ISSUER_ENV` (by default the `.env.local` of the author's Hardhat
project). `ICA2026_RPC` overrides the RPC endpoint, which makes a dry run
against a local Hardhat node possible.
