# tctc-mcp v1 — Test Report

Date: 2026-07-06
Scope: first implementation of the MCP server per
[MCP_SERVER_SPEC.md](./MCP_SERVER_SPEC.md) (v1, config-driven).
Result: **all tests passed** — 24/24 unit tests, and a live end-to-end
run against Sepolia through a real MCP client, including the full
on-chain grant → check → revoke → check kill-switch cycle.

---

## 1. Environment

| Item | Value |
|---|---|
| Runtime | Node.js 22, TypeScript 5, `@modelcontextprotocol/sdk` 1.x, viem 2.x |
| Transport | MCP stdio (server spawned by the SDK `Client` + `StdioClientTransport`) |
| Chain | Sepolia (Alchemy RPC) |
| Config under test | [`examples/config.sepolia.json`](../examples/config.sepolia.json) |
| Target contracts | Demo deployment of MCP_SERVER_SPEC.md §8: `AgentControlTokens` [`0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B`](https://sepolia.etherscan.io/address/0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B#code), `TCTCDemoToken` [`0xa52fe39D0de852e88488faa34e723E861D0b09BD`](https://sepolia.etherscan.io/address/0xa52fe39D0de852e88488faa34e723E861D0b09BD#code) |
| Admin signer / subject | `0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03` (dedicated Sepolia test key, supplied via `TCTC_ADMIN_PRIVATE_KEY`) |
| Caching | disabled for E2E (`--no-cache`) to read live state |

## 2. Unit tests (`npm test`, vitest)

24 tests in 4 files, all passing.

### 2.1 `test/config.test.ts` (9 tests)

- Minimal config parses; `typeId` normalized to `bigint`.
- `${ENV_VAR}` substitution works; an unset variable is a startup error.
- **A 32-byte hex value anywhere in the config is rejected as a
  probable private key** — both when written literally and when it
  arrives via `${ENV_VAR}` substitution.
- The one legitimate 32-byte hex value, `identity.erc6551.salt`, is
  exempted from that rejection.
- `erc1155` control tokens require `typeId`; `erc721` must not have one.
- References to undeclared chains (in `defaultChain` or a control
  token) are startup errors.
- `self.agentId` without an `identity` section is a startup error.
- The shipped `examples/config.sepolia.json` itself parses, including
  the `burnByIssuer(address,uint256,uint256)` revoke template.

### 2.2 `test/identity.test.ts` (2 tests)

- The off-chain ERC-6551 TBA computation **matches a ground-truth
  vector obtained from the canonical on-chain registry**
  (`0x000000006551c19487814612e58FE06813775758`) via `eth_call` to
  `account(implementation, salt, chainId, tokenContract, tokenId)`:
  for `(impl 0x41C8f394…44eC, salt 0x0, chainId 11155111,
  tokenContract TCTCDemoToken, tokenId 7)` both the registry and our
  implementation yield `0x3f9563ef9289abbfc9efc1e06497890dd44bde6f`.
- The computation is deterministic and sensitive to `tokenId`.

### 2.3 `test/admin.test.ts` (8 tests)

- Args templates map `$subject` / `$typeId` with ABI-driven coercion
  (`uint256` → `bigint`), e.g. `["$subject", "$typeId", 1]` →
  `[subject, 2n, 1n]` for `mint(address,uint256,uint256)`.
- `$typeId` on an `erc721` control token (no typeId) is rejected.
- Argument-count mismatches and non-address values for `address`
  parameters are rejected.
- Control-token selection: defaults to the sole token, demands
  `controlTokenIndex` when several are configured, rejects
  out-of-range indexes.

### 2.4 `test/roles.test.ts` (5 tests)

- **OR semantics**: the role is held when any one control token has
  `balanceOf > 0`; evidence lists every token with its balance.
- All-zero balances → `hasRole: false`.
- Unknown role → `ROLE_NOT_CONFIGURED`; RPC failure →
  `CHAIN_UNAVAILABLE` (stable error codes of spec §4).
- Repeated reads within the TTL are served from the cache (one RPC
  call per control token).

## 3. Live end-to-end test (`scripts/e2e-live.mjs`)

The server binary (`dist/index.js`) was spawned over stdio by a real
MCP client and exercised against Sepolia. Output:

```
✓ read-only: query tools registered (check_all_roles, check_role, list_roles)
✓ read-only: admin tools NOT registered
✓ read-only: list_roles reports mode
✓ read-only: MINTER_ROLE configured
✓ admin: all tools registered (check_all_roles, check_role, grant_role, list_roles, revoke_role)
✓ admin: subject starts without MINTER_ROLE
✓ admin: grant_role tx 0x598df08810163609bcddf9654849ebad4d4ec45e9013353e718b51996756a458
✓ admin: check_role now true (evidence balance 1)
✓ admin: revoke_role tx 0xd9dea986950f75a26cbf3b0a83b6027f525f752c5d6440de2cb9a7cd8791d8c6
✓ admin: check_role false after revoke — kill switch verified

E2E PASSED
```

### 3.1 Phase 1 — read-only mode

With `TCTC_ADMIN_PRIVATE_KEY` absent, the tool list contains only the
query tools. `grant_role` / `revoke_role` are **not registered at
all** (spec §1 "Operating modes", security consideration §5.4): an
agent-side client cannot even attempt a state change.
(`resolve_agent` is likewise absent because the test config has no
`identity` section.)

### 3.2 Phase 2 — admin mode, on-chain kill-switch cycle

| Step | Tool call | Result |
|---|---|---|
| 1 | `check_role(MINTER_ROLE, subject)` | `hasRole: false` (clean start) |
| 2 | `grant_role(MINTER_ROLE, subject)` | success — [`0x598df088…56a458`](https://sepolia.etherscan.io/tx/0x598df08810163609bcddf9654849ebad4d4ec45e9013353e718b51996756a458) (mints MinterCert, typeId 1) |
| 3 | `check_role(MINTER_ROLE, subject)` | `hasRole: true`, evidence balance `1` |
| 4 | `revoke_role(MINTER_ROLE, subject)` | success — [`0xd9dea986…91d8c6`](https://sepolia.etherscan.io/tx/0xd9dea986950f75a26cbf3b0a83b6027f525f752c5d6440de2cb9a7cd8791d8c6) (`burnByIssuer`, unilateral) |
| 5 | `check_role(MINTER_ROLE, subject)` | `hasRole: false` — **kill switch verified end-to-end** |

Every transaction was simulated before sending (revert reasons surface
as `TX_REVERTED`) and awaited to inclusion. The revoke used
`burnByIssuer`, i.e. the issuer revoked **without any cooperation from
the holder** — the property the original reference `ControlTokens`
deployment lacks (spec §5.5).

## 4. Conclusions

1. **v1 needed zero ERC-7303 changes**, as predicted in
   [CONCEPT.md](./CONCEPT.md) §5: `check_role` is plain `balanceOf`,
   grant/revoke are plain mint/burn.
2. The whole delegation loop — *principal grants a capability, agent
   verifies it, principal revokes it, capability is gone at the next
   check* — now runs through the standard MCP protocol against a
   public testnet.
3. The config-driven role map worked but had to be hand-assembled from
   Etherscan verified sources (spec §5.5 "invisible role structure") —
   the concrete friction that motivates the v2 introspection interface
   (CONCEPT.md §4.1).

## 5. How to reproduce

```bash
npm install && npm run build && npm test

ALCHEMY_API_KEY=...            \
TCTC_ADMIN_PRIVATE_KEY=0x...   \  # issuer key of AgentControlTokens
E2E_SUBJECT=0x...              \  # address to grant/revoke
node scripts/e2e-live.mjs
```

The E2E script is idempotent with respect to the demo deployment: it
requires the subject to start without the role and always revokes what
it grants.
