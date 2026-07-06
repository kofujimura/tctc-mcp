# tctc-mcp — Design Specification (v1)

An MCP (Model Context Protocol) server that exposes ERC-7303
token-controlled roles to AI agents and their human principals.

- **Agent side (read-only):** an agent can ask *"do I hold the role
  required for this action?"* before attempting it.
- **Principal side (admin):** a human (or supervising agent) can grant
  and revoke an agent's roles by minting/burning control tokens.
- **ERC-8004 bridge:** resolve an `agentId` to its owner, `agentWallet`,
  and ERC-6551 Token Bound Account, so permissions can be bound to the
  agent's identity NFT rather than a rotating wallet
  (see [CONCEPT.md](./CONCEPT.md) §3.2).

v1 is deliberately **config-driven**: the role → control-token mapping
is supplied in a config file, because ERC-7303 contracts do not yet
expose an on-chain introspection interface. The friction documented
while building v1 feeds the ERC-7303 interface proposal
([CONCEPT.md](./CONCEPT.md) §4.1); v2 replaces config with on-chain
auto-discovery.

---

## 1. Architecture

```
┌────────────┐  MCP (stdio)  ┌───────────────┐   JSON-RPC    ┌──────────────┐
│ AI agent / │◄─────────────►│   tctc-mcp    │◄─────────────►│  EVM chain   │
│ MCP client │               │               │    (viem)     │ (Sepolia, …) │
└────────────┘               │ • role config │               │ control      │
                             │ • RPC clients │               │ tokens,      │
                             │ • signer (opt)│               │ ERC-8004 /   │
                             └───────────────┘               │ 6551 regs    │
                                                             └──────────────┘
```

| Item | Choice | Rationale |
|---|---|---|
| Language | TypeScript (Node ≥ 20) | MCP SDK maturity; ecosystem reach |
| MCP SDK | `@modelcontextprotocol/sdk` | official |
| Chain access | `viem` | typed, light, multi-chain |
| Transport | stdio (v1) | works in Claude Code / Desktop out of the box; Streamable HTTP is a v2 option |
| Package | `tctc-mcp` on npm, runnable via `npx tctc-mcp` | zero-install onboarding |

### Operating modes

The server runs in one of two modes, decided at startup:

- **read-only** — no signer configured. Only query tools are
  registered; state-changing tools are not exposed at all (an agent
  cannot even attempt them).
- **admin** — a signer is configured via the `TCTC_ADMIN_PRIVATE_KEY`
  environment variable (never via the config file). Grant/revoke tools
  are registered in addition to the query tools.

This maps to the two personas: the *agent's* MCP config is read-only;
the *principal's* MCP config is admin.

## 2. Configuration

Path given by `--config <file>` or `TCTC_CONFIG`; JSON.

```jsonc
{
  "chains": {
    "sepolia": {
      "chainId": 11155111,
      "rpcUrl": "https://rpc.sepolia.org"        // or ${ENV_VAR} substitution
    }
  },
  "defaultChain": "sepolia",

  // The off-chain role → control-token map (v1's core compromise).
  "roles": {
    "MINTER_ROLE": {
      "description": "May mint product NFTs on the Example contract",
      "controlTokens": [
        {
          "chain": "sepolia",
          "standard": "erc721",                  // "erc721" | "erc1155"
          "address": "0xControlToken…",
          "typeId": null                          // required iff erc1155
        }
      ],
      // Optional, admin mode: how to grant/revoke on this control token.
      // "args" is a template: "$subject" → resolved subject address,
      // "$typeId" → the control token's typeId; other entries are
      // literals. Defaults to ["$subject"] when omitted.
      "admin": {
        "grant": { "function": "safeMint(address)" },
        "revoke": { "function": "burn(address,uint256,uint256)",
                    "args": ["$subject", "$typeId", 1] }
      }
    }
  },

  // Optional ERC-8004 / ERC-6551 bridge.
  "identity": {
    "chain": "sepolia",
    "identityRegistry": "0xIdentityRegistry…",
    "erc6551": {
      "registry": "0x000000006551c19487814612e58FE06813775758",
      "accountImplementation": "0xAccountImpl…",
      "salt": "0x0"
    }
  },

  // Optional: this agent's own account, used as the default subject of
  // check_role. Either a raw address or an agentId to resolve to a TBA.
  "self": { "agentId": 42 }                       // or { "address": "0x…" }
}
```

Rules:

- `${VAR}` values are substituted from the environment at load time.
- Private keys are **rejected** if found anywhere in the config file.
- A role with multiple `controlTokens` is held if **any** of them has
  `balanceOf > 0` (OR semantics, matching ERC-7303).

## 3. Tools

All tools return structured JSON content. Query tools are available in
both modes; admin tools only in admin mode.

### 3.1 `list_roles`

List the configured roles and their control tokens.

- **Input:** none
- **Output:**
  ```json
  { "roles": [ { "name": "MINTER_ROLE", "description": "…",
                 "controlTokens": [ { "chain": "sepolia", "standard": "erc721",
                                      "address": "0x…", "typeId": null } ] } ] }
  ```

### 3.2 `check_role`

Check whether an account holds a role. This is a plain
`balanceOf(account)` (ERC-721) / `balanceOf(account, typeId)` (ERC-1155)
call on each configured control token — no ERC-7303 changes required.

- **Input:**
  ```json
  { "role": "MINTER_ROLE",
    "subject": { "address": "0x…" } }   // or { "agentId": 42 } → resolves to TBA
                                        // omitted → config "self"
  ```
- **Output:**
  ```json
  { "role": "MINTER_ROLE", "subject": "0xResolved…", "hasRole": true,
    "evidence": [ { "controlToken": "0x…", "standard": "erc721",
                    "balance": "1" } ] }
  ```

### 3.3 `check_all_roles`

Same subject resolution as `check_role`; returns the hasRole verdict
for every configured role in one call. Intended for an agent's
session-start self-assessment ("what am I allowed to do right now?").

### 3.4 `resolve_agent` *(requires `identity` config)*

Resolve an ERC-8004 `agentId` to its current control structure.

- **Input:** `{ "agentId": 42 }`
- **Output:**
  ```json
  { "agentId": 42,
    "owner": "0xNftOwner…",
    "agentURI": "ipfs://…",
    "agentWallet": "0x…| null",
    "tba": { "address": "0xComputed…", "deployed": true } }
  ```
- The TBA address is computed off-chain from
  `(chainId, identityRegistry, agentId)` per ERC-6551 (deterministic,
  valid even before deployment); `deployed` reports whether code exists
  at that address.

### 3.5 `grant_role` *(admin mode only)*

Mint the role's control token to a subject.

- **Input:**
  ```json
  { "role": "MINTER_ROLE",
    "subject": { "agentId": 42 },      // resolved to the TBA — the
                                       // recommended binding target
    "controlTokenIndex": 0 }           // optional if the role has one token
  ```
- **Behavior:** calls the configured `admin.grant` function from the
  signer account; waits for inclusion.
- **Output:** `{ "txHash": "0x…", "status": "success", "subject": "0x…" }`

### 3.6 `revoke_role` *(admin mode only)*

Burn the subject's control token — the on-chain kill switch. Same shape
as `grant_role`, calling `admin.revoke`.

> The MCP client's own permission prompt is the confirmation layer for
> these two tools; the server additionally annotates them as
> destructive/state-changing in their tool metadata so clients can
> require approval.

## 4. Behavior details

- **Subject resolution order:** explicit `address` → explicit `agentId`
  (→ TBA) → config `self`. Every response echoes the resolved address
  so there is no ambiguity about who was checked.
- **Freshness:** `check_role` results are read live; an optional
  in-memory cache (default TTL 10 s, `--no-cache` to disable) absorbs
  bursts. Revocation latency tolerance belongs to the *caller's*
  security model, so the TTL is deliberately short and documented.
- **Errors** are returned as MCP tool errors with stable codes:
  `ROLE_NOT_CONFIGURED`, `CHAIN_UNAVAILABLE`, `SUBJECT_UNRESOLVED`,
  `NOT_ADMIN_MODE`, `TX_REVERTED` (with revert reason when decodable).
- **No custody surprises:** the server never generates keys, never
  persists keys, and in read-only mode performs no signing at all.

## 5. Security considerations

1. **Admin key scope.** The signer only needs mint/burn authority on
   the control-token contracts — it should be a dedicated issuer key,
   not the principal's main wallet.
2. **Check ≠ enforcement.** `check_role` is advisory UX for the agent;
   the *enforcing* check is the ERC-7303 modifier on-chain. A malicious
   agent skipping `check_role` gains nothing — its transaction reverts.
   Documentation must state this explicitly to avoid the server being
   mistaken for a policy enforcement point.
3. **Config integrity.** The role map is trusted input; a tampered
   config could point `check_role` at the wrong token. v2's on-chain
   auto-discovery (below) removes this trust dependency.
4. **Read-only by default.** Absence of the env key not only disables
   admin tools but never registers them, minimizing prompt-injection
   surface on the agent side.
5. **Observed friction on the existing Sepolia deployment** (recorded
   here as evidence for the spec updates of CONCEPT.md §4):
   - *No issuer-side revocation.* The deployed `ControlTokens`
     (`0x5E82784b…`) uses OpenZeppelin `ERC1155Burnable`, whose
     `burn(account, id, value)` succeeds only for the holder or an
     operator the holder approved. The issuer/owner cannot
     unilaterally burn — i.e. the kill switch does not work on this
     deployment unless the holder pre-approves the issuer. This is
     exactly why control tokens granted to agents **MUST be
     issuer-burnable** (CONCEPT.md §4.1). *Resolved for the demo* by
     deploying `AgentControlTokens` (soulbound, `burnByIssuer`) — see
     §8 below; the full grant → use → revoke → denied cycle was
     verified on-chain on 2026-07-06.
   - *Invisible role structure.* The role → control-token bindings and
     the target-side role conjunction (`MyComplexToken.safeMint`
     requires MINTER_ROLE **and** MEMBER_ROLE via two modifiers) are
     only discoverable by reading verified source on Etherscan; the
     config (and therefore `check_role`) can express the per-role OR
     but not the per-function AND. Both would be solved by the
     introspection interface of CONCEPT.md §4.1.

## 6. Project layout

```
erc7303/
├── docs/                    # CONCEPT.md, MCP_SERVER_SPEC.md (this file)
├── src/
│   ├── index.ts             # entrypoint: mode detection, MCP wiring
│   ├── config.ts            # schema (zod), env substitution, validation
│   ├── chain.ts             # viem clients per chain
│   ├── roles.ts             # balanceOf checks, OR semantics, cache
│   ├── identity.ts          # ERC-8004 reads + ERC-6551 TBA computation
│   ├── admin.ts             # grant/revoke tx construction
│   └── tools/               # one file per MCP tool
├── test/                    # vitest; anvil-based integration tests
├── examples/
│   ├── config.sepolia.json  # pointing at the existing TCTC deployments
│   └── claude.mcp.json      # sample MCP client registration
└── package.json
```

Testing: unit tests with mocked viem transports; integration tests
against `anvil` with the TCTC reference contracts deployed in-test;
one live smoke test against the existing Sepolia deployment (manual /
CI-optional).

## 7. Roadmap

- **v1 (this spec):** config-driven; query + admin tools; ERC-8004/6551
  resolution; Sepolia example config.
- **v1.1:** expiry awareness — if a control token exposes an expiry
  interface (ERC-5643-style), report `expiresAt` in `check_role`
  evidence.
- **v2:** on-chain auto-discovery — given only a target contract
  address, read `getControlTokens` / `hasRole` / ERC-165 from the
  proposed ERC-7303 introspection interface and drop the `roles`
  section of the config entirely. This release is the demonstration
  that motivates the spec change.
- **v2.x:** tool-gating middleware (proxy other MCP servers' tools,
  allowing calls only while the agent's TBA holds the mapped role) —
  the full "burn the token, the agent instantly loses the tool" demo.

## 8. Demo deployment (Sepolia)

Deployed and Etherscan-verified on 2026-07-06 specifically for this
server (sources in [`examples/contracts/`](../examples/contracts/)):

| Contract | Address | Notes |
|---|---|---|
| `AgentControlTokens` | [`0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B`](https://sepolia.etherscan.io/address/0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B#code) | ERC-1155 control tokens; **soulbound** (transfers revert) and **issuer-burnable** (`burnByIssuer`, `onlyOwner`); typeId 1 = MinterCert, 2 = BurnerCert; grant = `mint(address,uint256,uint256)` |
| `TCTCDemoToken` | [`0xa52fe39D0de852e88488faa34e723E861D0b09BD`](https://sepolia.etherscan.io/address/0xa52fe39D0de852e88488faa34e723E861D0b09BD#code) | ERC-721 + ERC-7303 target; `safeMint(address)` gated by MINTER_ROLE, `burn(uint256)` by BURNER_ROLE |

The kill-switch cycle was smoke-tested on-chain: mint MinterCert →
`safeMint` succeeds → `burnByIssuer` → `safeMint` reverts with
`ERC7303: not has a required token`. This deployment embodies the
control-token requirements of CONCEPT.md §4.1 (non-transferable,
issuer-burnable) and is what
[`examples/config.sepolia.json`](../examples/config.sepolia.json)
points at.
