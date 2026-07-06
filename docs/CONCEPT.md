# TCTC for AI Agent Authorization

**Background, design rationale, and adoption strategy**

This document summarizes the design discussion on positioning TCTC
(Token-Controlled Token Circulation, standardized as [ERC-7303]) as an
on-chain authorization layer for AI agents, complementing [ERC-8004]
(Trustless Agents).

[ERC-7303]: https://eips.ethereum.org/EIPS/eip-7303
[ERC-8004]: https://eips.ethereum.org/EIPS/eip-8004

---

## 1. What TCTC / ERC-7303 provides

TCTC represents **roles as tokens**. A contract that adopts ERC-7303
designates one or more ERC-721 / ERC-1155 *control tokens* per role; an
account holds a role if and only if `balanceOf(account) > 0` on a control
token bound to that role. Granting a permission is minting a token;
revoking it is burning the token.

Key properties:

- **Serverless authorization.** No off-chain permission server (ERC-5982
  style) is needed. The chain itself is the policy decision point.
- **Composable.** Any existing ERC-721/1155 can act as a control token,
  including soulbound (non-transferable) tokens. Control can be recursive
  (control tokens governed by other control tokens).
- **Auditable.** Every grant/revoke is an on-chain transaction.

Reference implementation: <https://github.com/kofujimura/TCTC>
(includes deployments on Sepolia and Polygon zkEVM).

## 2. Why the AI-agent era raises its value

Autonomous agents increasingly hold wallets and act on-chain and
off-chain on behalf of humans. Delegating authority to an agent raises
questions that TCTC answers directly:

| Need | TCTC answer |
|---|---|
| Grant an agent a scoped capability | Mint a control token (SBT) to the agent's account |
| Revoke instantly when the agent misbehaves | Burn the control token; the agent loses the capability at the next transaction |
| Let third parties verify an agent's authority | Anyone can read `balanceOf` on the control token |
| Avoid running/trusting a permission server | Policy lives on-chain; enforcement happens at execution time |

The human principal keeps a kill switch (burn) that works without any
centralized infrastructure, and the agent's authority is legible to the
whole ecosystem.

## 3. Relationship to ERC-8004

ERC-8004 (Trustless Agents) and ERC-7303 are complementary layers:

| Layer | Standard | Question answered |
|---|---|---|
| Identity | ERC-8004 Identity Registry (ERC-721; each agent is an NFT with an `agentId`) | *Who is this agent?* |
| Reputation / validation | ERC-8004 Reputation & Validation Registries | *Is this agent any good? Was this work verified?* |
| **Authorization** | **ERC-7303 control tokens** | ***What is this agent allowed to do?*** |

ERC-8004 deliberately does not define an authorization mechanism.
ERC-7303 fills that gap without modifying ERC-8004.

### 3.1 The identity-unit mismatch

ERC-7303 checks permissions per **address**; ERC-8004 identifies agents
per **agentId** (an NFT tokenId). The controlling addresses of an agent
are mutable:

- `agentWallet` can be rotated via `setAgentWallet()`, and is
  auto-cleared when the agent NFT is transferred;
- the NFT owner and operators can change.

Minting a control token directly to an agent's operational wallet
therefore risks stranding (or leaking) permissions when wallets rotate.

### 3.2 Recommended pattern: bind permissions to the agent NFT via ERC-6551

Derive the [ERC-6551] Token Bound Account (TBA) of the agent's identity
NFT and mint control tokens **to the TBA**:

```
ERC-8004 Identity Registry (ERC-721)
  └─ tokenId = agentId                     ← the agent's identifier
       └─ ERC-6551 TBA (deterministic addr) ← the agent's "wallet"
            └─ holds ERC-7303 control tokens (SBTs) = the agent's permissions
```

Note that `agentId` and the TBA are distinct things: the agentId is a
tokenId (a number); the TBA is a contract account whose address is
deterministically derived from `(chainId, registry address, tokenId)`
and whose control always follows the current NFT owner. The TBA address
is counterfactual — it can receive tokens before deployment.

Two execution models were considered:

- **Model A (recommended): the agent acts *as* the TBA.** The agent's
  operational key calls `TBA.execute()`, so the target contract sees
  `msg.sender == TBA` and the **unmodified** ERC-7303 check
  `balanceOf(msg.sender) > 0` passes. Permissions survive wallet
  rotation and NFT transfer. If an operational key leaks, the NFT owner
  regains control by rotating it — the permissions never left the TBA.
- **Model B: the agent acts from its own wallet** and the target
  resolves caller → agentId → TBA. This requires a new
  `onlyAgentHasToken(role, agentId)` check plus caller-legitimacy
  verification against the Identity Registry — significantly more
  complex. Not recommended for the base pattern.

Model A means the ERC-8004 + ERC-6551 + ERC-7303 combination works
**today, with no changes to any of the three standards** — it is a
best-practice profile, not a protocol change.

[ERC-6551]: https://eips.ethereum.org/EIPS/eip-6551

## 4. Recommended ERC-7303 specification updates

ERC-7303 is still in Draft status, so the core can be amended. The
guiding principle: keep the core minimal; move agent-specific profiles
into a companion ERC.

### 4.1 Add to ERC-7303 itself

1. **External introspection interface.** Today the reference
   implementation stores role→control-token bindings in internal
   mappings with no getters and no events, so third parties (and
   tooling) cannot discover the role structure of a compliant contract.
   Add:
   - `hasRole(bytes32 role, address account) → bool`
   - `getControlTokens(bytes32 role) → (address[] contracts, uint256[] typeIds)`
   - ERC-165 support, so compliance is machine-detectable
   - Events on role/control-token configuration (indexer support)
2. **Strengthened Security Considerations** for agent delegation:
   - control tokens granted to agents SHOULD be non-transferable and
     MUST be burnable by the issuer;
   - clarify which `msg.sender` passes the check under ERC-8004's
     owner / operator / agentWallet multiplicity and under ERC-4337
     smart accounts with session keys (the check sees the account, not
     the session key).

### 4.2 Companion ERC ("Token-Controlled Agent Delegation")

A separate proposal profiling ERC-7303 + ERC-8004 + ERC-6551:

- the TBA-binding pattern of §3.2 as the normative profile;
- **expiring control tokens** (ERC-5643-style expiry, or tokens whose
  `balanceOf` returns 0 after a deadline) so short-lived delegations
  ("for one hour", "for this task") fail safe without a revocation
  transaction;
- optional declaration of held/required roles in the ERC-8004
  registration file (`agentURI`), enabling off-chain discovery followed
  by on-chain enforcement.

## 5. Adoption strategy

Priority order agreed in the discussion:

1. **MCP server (`tctc-mcp`)** — lets any MCP-compatible AI agent check,
   and any human principal grant/revoke, on-chain permissions. The MCP
   server itself is the proof-of-concept of TCTC as the agent
   authorization layer. See [MCP_SERVER_SPEC.md](./MCP_SERVER_SPEC.md).
2. **Demo + video** — a human dashboard granting/revoking role SBTs to a
   live agent whose capabilities change in real time ("the human burns a
   token; the agent instantly loses the tool").
3. **Agent skill** (`npx skills add` distributable) — the TCTC design
   pattern, scaffolding recipes, and the delegation workflow, written
   for AI agents to consume.
4. Medium-term: npm package `@tctc/contracts`, an OpenZeppelin-Wizard
   style generator, the companion ERC, and an ERC-7579 validation module
   ("session key valid only while holding the role token").

### Implementation-driven standardization

Deliberately build the MCP server **v1 against the current spec**
(config-driven: the role → control-token map is supplied off-chain),
and let the pain points encountered there justify the introspection
interface of §4.1. "A real consumer exists and cannot generalize
without these view functions" is a far stronger argument on Ethereum
Magicians than a speculative interface proposal — and it promotes the
spec and the tooling at the same time.

Note that v1 needs **no ERC-7303 changes at all**: `check_role` is a
plain `balanceOf` call on standard ERC-721/1155 contracts, and
grant/revoke are `mint`/`burn` on the control-token contracts.
