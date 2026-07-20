# tctc-gate

Token-gate **any existing MCP server** with [ERC-7303](https://eips.ethereum.org/EIPS/eip-7303) roles — no server modification. The agent talks to the gate, the gate talks to the wrapped server, and every `tools/call` passes an on-chain role check before it is forwarded. **Grant is a mint. Revoke is a burn.** For any MCP tool.

Status: **v0.1 on npm** ([`tctc-gate`](https://www.npmjs.com/package/tctc-gate)) — M1/M2 of [docs/GATE_SPEC.md](../docs/GATE_SPEC.md) implemented (transparent stdio proxy, policy engine, `configured` subject, pinned-block admission checks, `tctc_gate_status`). Proved-subject mode (SIWE, signer ≠ subject) is specified for v1.1 and not yet implemented.

```
agent (MCP client) ──stdio──▶ tctc-gate ──stdio──▶ wrapped MCP server (unmodified)
                                  │
                                  └── hasRole / balanceOf ──▶ chain
```

## Quick start

No clone or build needed — put the gate in front of any MCP server your
client is configured to run. Write a `gate.json` (see Config below), then
change the server's launch command from

```sh
npx -y some-mcp-server …
```

to

```sh
npx -y tctc-gate --config gate.json -- npx -y some-mcp-server …
```

Everything after `--` is the wrapped server's own command line; the gate is
invisible to both sides except when a call is denied. The release pipeline
verifies the packed bin end to end
([scripts/verify-pack.mjs](scripts/verify-pack.mjs)); as with tctc-mcp, the
bin is the only supported entry point — never import the package's `dist/`
files.

## Try the demo

```sh
# from the repo root
cd gate && npm run build
node dist/index.js --config examples/gate.sepolia.json
```

`examples/gate.sepolia.json` wraps the test fixture server and gates its `echo` tool behind `MINTER_ROLE` on the Sepolia demo target. Point your MCP client at the command above; then:

- `tctc_gate_status` — see the subject's verdicts with balance evidence
- calling `echo` without the role returns `TCTC_ROLE_DENIED` **with a grant URL** — open it and the [dashboard](https://tctc-mcp.vercel.app/) loads with target, subject and role pre-filled, one Grant click away
- after the grant, `echo` just works; after `Revoke ✕` (burn), the next call is refused — the kill switch through an unmodified server

The live E2E (`node scripts/e2e-gate.mjs` from the repo root, with `E2E_ISSUER_PRIVATE_KEY`) drives exactly this cycle on Sepolia: 14 checks, including deny-before-grant, allow-after-mint, deny-after-burn.

## Config

```jsonc
{
  "chain": { "key": "sepolia", "chainId": 11155111, "rpcUrl": "https://ethereum-sepolia-rpc.publicnode.com" },
  "target": "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",   // any IERC7303 contract
  "subject": { "mode": "configured", "address": "0x…" },     // whose roles gate this session
  "gate": {
    "public": ["get_info"],                                   // exact names, never checked
    "tools": { "write_file": ["MINTER_ROLE"], "delete_*": ["ADMIN_ROLE"] }  // AND across roles
  },
  "cache": { "allowSeconds": 0, "denySeconds": 10 },          // allow verdicts are live by default
  "server": {
    "command": "npx",
    "args": ["-y", "some-mcp-server@1.2.3", "…"],             // pin versions inside a security boundary
    "env": { "API_KEY": "${UPSTREAM_KEY}" },                  // ${ENV} references only — never literals
    "inherit": ["PATH", "HOME"]                               // the child gets nothing else
  }
}
```

Unlisted tools are **denied** (`TCTC_TOOL_UNMAPPED`). Role checks are the target contract's own `hasRole()`, read **pinned to a fetched block number** that is reported back as `observedBlockNumber`. Allow verdicts are uncached by default: for off-chain resources the gate's allow *is* the authorization, so a cached allow would be a real permission extension — revocation latency is one call, not one TTL.

## Security model (short form)

- **Fail closed.** RPC down, config wrong, chain mismatch → deny. No `failOpen`.
- The gate needs **no keys for role management**; when wrapping a credentialed upstream it holds that credential in its own process env and injects it into the child — the agent's environment never contains it.
- A proxy cannot prevent bypass by itself; it makes the gated path the only *usable* path. On-chain targets enforce themselves; credentialed upstreams are protected by credential asymmetry; ambient resources (files, shells) need OS-level isolation. The full, honest treatment — including what same-UID deployment does and does not give you — is in [GATE_SPEC.md §2](../docs/GATE_SPEC.md).

## Relation to tctc-mcp

Same authorization core (`core/`, shared sources + cross-implementation test vectors), opposite direction: **tctc-mcp** lets agents *ask* about and principals *manage* roles; **tctc-gate** *enforces* them at an MCP boundary. Class-level authorization only — instance-level validation (`validate_action`) composes above it.
