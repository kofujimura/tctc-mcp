# tctc-mcp

[![npm version](https://img.shields.io/npm/v/tctc-mcp)](https://www.npmjs.com/package/tctc-mcp)

An MCP server exposing [ERC-7303](https://eips.ethereum.org/EIPS/eip-7303)
(Token-Controlled Token Circulation) roles to AI agents: agents check
their own on-chain permissions, and human principals grant/revoke them
by minting/burning control tokens — no permission server required.

Status: **v1 published on npm** ([`tctc-mcp`](https://www.npmjs.com/package/tctc-mcp))
— unit-tested and verified end-to-end against the Sepolia demo
deployment (grant → check → revoke → check through a real MCP client).

## Demo (60 seconds)

[![Watch the 60-second demo video](docs/tctc-mcp-demo-thumb.png)](https://www.youtube.com/watch?v=o547bwYT32A)

*A human grants an AI agent a minting permission; the agent verifies it
on-chain and mints an NFT. The human burns the role token — and the
agent instantly loses the capability. Live on Sepolia, no permission
server involved.*

## Quick start

The package is published on npm, so no clone or build is needed — `npx`
fetches and runs it directly:

```bash
# 1. Get a config. The secret-free Sepolia demo config needs no API keys:
curl -fsSLO https://raw.githubusercontent.com/kofujimura/tctc-mcp/main/examples/config.sepolia.agent.json

# 2. Register with your MCP client, e.g. Claude Code
#    (read-only mode: only query tools are registered)
claude mcp add tctc -- npx -y tctc-mcp --config "$PWD/config.sepolia.agent.json"

# Admin mode (principal side): grant_role / revoke_role also registered.
# Provide the issuer key ONLY via the environment:
claude mcp add tctc-admin --env TCTC_ADMIN_PRIVATE_KEY=0x... \
  -- npx -y tctc-mcp --config "$PWD/config.sepolia.json"
```

Or in a project-scoped `.mcp.json`:

```json
{ "mcpServers": { "tctc": { "command": "npx",
    "args": ["-y", "tctc-mcp", "--config", "examples/config.sepolia.agent.json"] } } }
```

A fuller registration example is in
[examples/claude.mcp.json](examples/claude.mcp.json). The admin private
key is only ever read from the `TCTC_ADMIN_PRIVATE_KEY` environment
variable; configs containing anything that looks like a private key are
rejected at startup.

## Tools

| Tool | Mode | Purpose |
|---|---|---|
| `list_roles` | both | Configured roles and their control tokens |
| `check_role` | both | Does an account hold a role? (live `balanceOf`, with evidence) |
| `check_all_roles` | both | Session-start self-assessment across all roles |
| `resolve_agent` | both* | ERC-8004 `agentId` → owner / agentURI / agentWallet / ERC-6551 TBA |
| `grant_role` | admin | Mint the control token to a subject |
| `revoke_role` | admin | Burn the subject's control token — the kill switch |

\* registered only when the config has an `identity` section.

Subjects can be given as a raw `address`, as an ERC-8004 `agentId`
(resolved to its ERC-6551 Token Bound Account, the recommended binding
target), or omitted to use the config's `self`.

## Documents

- [docs/CONCEPT.md](docs/CONCEPT.md) — background and rationale: TCTC as
  the authorization layer for AI agents, its relationship to ERC-8004
  (Trustless Agents) and ERC-6551 (Token Bound Accounts), recommended
  ERC-7303 spec updates, and the adoption strategy.
- [docs/MCP_SERVER_SPEC.md](docs/MCP_SERVER_SPEC.md) — v1 design
  specification (architecture, config, tools, security, roadmap).
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) — v1 test report: 24 unit
  tests and the live Sepolia E2E (on-chain kill-switch cycle through a
  real MCP client).
- [examples/config.sepolia.json](examples/config.sepolia.json) —
  concrete config for the Sepolia demo deployment (primary roles) and
  the original TCTC reference deployment (`COMPLEX_*` roles).
- [examples/config.sepolia.agent.json](examples/config.sepolia.agent.json)
  — secret-free agent-side config for the same demo deployment (public
  RPC, no API keys); the one used in the Quick start above.
- [examples/contracts/](examples/contracts/) — sources of the demo
  contracts deployed on Sepolia (`AgentControlTokens`,
  `TCTCDemoToken`, `ERC7303`).

## Demo deployment (Sepolia, Etherscan-verified)

- `AgentControlTokens` (soulbound, issuer-burnable ERC-1155):
  [`0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B`](https://sepolia.etherscan.io/address/0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B#code)
- `TCTCDemoToken` (ERC-721 + ERC-7303 target):
  [`0xa52fe39D0de852e88488faa34e723E861D0b09BD`](https://sepolia.etherscan.io/address/0xa52fe39D0de852e88488faa34e723E861D0b09BD#code)

## Development

```bash
git clone https://github.com/kofujimura/tctc-mcp.git && cd tctc-mcp
npm install && npm run build
node dist/index.js --config examples/config.sepolia.agent.json

npm test                  # unit tests (vitest)
node scripts/e2e-live.mjs # live E2E: spawns the server via MCP stdio client
                          # (needs ALCHEMY_API_KEY; admin phase additionally
                          #  TCTC_ADMIN_PRIVATE_KEY and E2E_SUBJECT)
```

## Related

- npm package: <https://www.npmjs.com/package/tctc-mcp>
- Agent skill (teaches agents to use TCTC safely; install with
  `npx skills add kofujimura/tctc-skills`):
  <https://github.com/kofujimura/tctc-skills>
- TCTC reference implementation: <https://github.com/kofujimura/TCTC>
