# tctc-gate — Design Specification (v1 draft, revised)

**Status: design draft, 2026-07-18, revised through two rounds of
independent cross-model review. Nothing here is implemented yet.**

`tctc-gate` adds ERC-7303 token-gating to **existing, unmodified MCP
servers**. It is a transparent MCP proxy: the agent talks to the gate, the
gate talks to the wrapped server, and every `tools/call` passes an
on-chain role check before it is forwarded. Grant is a mint, revoke is a
burn — for any MCP tool, without touching the server that provides it.

```
agent (MCP client)
      │  stdio (MCP)
      ▼
┌───────────────┐     role check      ┌──────────────┐
│   tctc-gate   │────────────────────▶│  Ethereum    │
│  (this spec)  │  hasRole/balanceOf  │  (any chain) │
└───────┬───────┘                     └──────────────┘
        │  stdio (MCP, forwarded)
        ▼
┌───────────────┐
│  wrapped MCP  │   ← completely unmodified
│    server     │
└───────────────┘
```

## 1. Why a gateway (and not an SDK)

Two ways exist to token-gate an MCP tool:

- **SDK integration** — the server's author imports a library and
  annotates tools. Requires the author's cooperation, per-server work,
  and a new release of every server.
- **Wrapper gateway** (this design) — the *principal* wraps any server
  they already run. Zero server modification, works with the long tail of
  existing servers today, and the permission layer is chosen by the party
  who bears the risk: the human delegating authority.

The wrapper approach is TCTC applied to MCP: the target (wrapped server)
stays unmodified, and circulation control lives in a layer the issuer
controls — exactly how `ExpiringControlTokens` gated an unmodified
`TCTCDemoToken` on Sepolia.

Scope claim, stated precisely: tctc-gate needs **no separate database or
API for role state** — roles live on-chain and the chain is their source
of truth. For off-chain resources the gate itself *is* the authorization
enforcement point at the MCP boundary (see §2), and it does not pretend
otherwise.

## 2. Deployment & threat model

The v1 deployment is **principal-configured local delegation** over
stdio: one gate process, one wrapped server (its child), one client
session, config owned by the principal.

- The principal owns the MCP client configuration and decides that the
  agent reaches the wrapped server *only* through the gate.
- The gate needs **no keys for role management** — role checks are
  public reads. When it wraps a credentialed upstream, however, it
  *does* temporarily handle that upstream's credential (§2.2); the spec
  does not claim otherwise.
- **Fail closed, always**: RPC unreachable, config unresolvable, chain
  mismatch, identity unresolved → deny. There is no `failOpen` option,
  deliberately. (One precise exception: a still-valid allow-cache entry
  the principal explicitly enabled is honored until it expires — §6;
  fail-closed governs *fresh* admissions.)
- At startup the gate calls `eth_chainId` and refuses to serve if it
  differs from the configured `chainId` — the RPC endpoint is the
  authorization oracle for off-chain resources, so its identity must be
  pinned, not assumed.

### 2.1 Bypass resistance

A proxy cannot, by itself, prevent being bypassed; the defense is making
the gated path the *only* usable path. In the stdio deployment the gated
instance itself is not interceptable — the wrapped server is the gate's
child and only the gate holds its stdin — so "bypass" means the agent
*standing up its own path*: spawning a fresh server instance or reaching
the underlying resource directly. Whether that succeeds depends on the
resource class:

- **Class A — on-chain resources: the chain defends itself.** If the
  action is ultimately submitted to an **ERC-7303-enforcing target**,
  bypassing the gate does not bypass the target's on-chain modifier —
  the transaction reverts. The gate is UX and early denial there;
  enforcement was never the proxy. (On-chain actions against contracts
  that do *not* enforce ERC-7303 get no such backstop and fall into
  Class B/C reasoning.)
- **Class B — credentialed upstreams: credential asymmetry raises the
  bar; OS isolation completes it.** The upstream credential lives in the
  gate's process environment and is injected into the child at spawn; it
  is never placed in the agent's environment or in config files. A
  self-spawned copy of the server therefore reaches nothing. This
  defeats accidents and casual self-spawning — but it is **not** a
  boundary against a malicious agent running as the *same OS user*: a
  same-uid process may be able to read `/proc/<pid>/environ` or ptrace
  its siblings, depending on the OS's ptrace/procfs policy — **same UID
  is not a sufficient isolation boundary**. Against a malicious
  shell-capable agent, Class B requires the same isolation as Class C.
- **Class C — ambient resources (files, local commands): OS isolation
  required.** No proxy can protect a credential-free resource from a
  same-user agent with shell access. Either run the gate + resource
  under a separate OS user / container so the agent's only route is the
  gate's MCP connection, or acknowledge that in a same-user setup the
  gate is **drift/accident prevention, not malicious-agent
  containment**. Docs state this plainly.

Cross-cutting: gate config and the MCP client config must be
principal-owned and agent-read-only (a Class C concern). The audit log
(§6) can be reconciled against upstream provider logs as a *detection
aid* — a call upstream with no matching gate entry indicates a bypass,
and since grants/revokes are public on-chain, upstream access during a
no-role window is checkable evidence. This is reconciliation tooling,
not an enforcement guarantee.

### 2.2 Child-process hygiene

- `inheritEnv: false` is the default: the child receives **only** the
  variables listed in `server.env` plus an explicit allowlist
  (`server.inherit`, e.g. `["PATH", "HOME"]`).
- Upstream credentials are referenced as `${ENV_NAME}` in `server.env`
  and resolved from the gate's own environment at spawn; literal secret
  values in config are rejected (§4.2).
- The wrapped server must be **version-pinned**. Running `npx -y
  <floating-package>` inside a security boundary executes whatever the
  registry serves that day; docs require a pinned version
  (`package@x.y.z`) or a local install.

## 3. Identity: whose roles are checked?

### 3.1 v1: `configured` mode only

```jsonc
"subject": { "mode": "configured", "address": "0x31F8…5d03" }
```

The principal pins the subject wallet in config. No proof of key
possession — and none is needed under the v1 threat model: the principal
controls the config, the agent cannot edit it, so "which wallet's roles
gate this session" is the principal's declaration. Kill switch and
auto-expiry work unchanged. Honest limitation: this authenticates the
*session setup*, not the caller; one gate process = one subject.

### 3.2 v1.1+: `prove` mode (deferred by design)

Proof of key possession matters when the gate is remote or shared —
neither is true in v1, so challenge–response ships in v1.1, not v1.
Design constraints recorded now so v1 doesn't paint over them:

- **Role subject and authentication signer are separate fields.** The
  recommended agent-identity model binds control tokens to an ERC-6551
  TBA while a controller key signs:

  ```jsonc
  "subject":        { "address": "0xTBA…" },
  "authentication": { "mode": "eip191", "signer": "0xController…" }
  ```

  The gate verifies the signer controls the subject (registry
  derivation / ERC-1271), then checks the *subject's* roles. Collapsing
  the two (recovered signer = subject) would lock TBAs out.
- The challenge is either **EIP-4361-conformant SIWE** (all required
  fields: domain, address, URI, version, chain-id, nonce, issued-at) or
  explicitly a custom format — not "SIWE-shaped".
- Until authentication, gated tools deny with `TCTC_IDENTITY_UNPROVEN`.

## 4. Policy model

Roles come from a **single ERC-7303 target contract** (v1), resolved as
tctc-mcp (v0.3.x) does: IERC7303 introspection, the contract explains
its own role structure, and the verdict is the target's own `hasRole`.

```jsonc
{
  "chain": { "key": "sepolia", "chainId": 11155111,
             "rpcUrl": "https://ethereum-sepolia-rpc.publicnode.com" },
  "target": "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
  "subject": { "mode": "configured", "address": "0x…" },
  "gate": {
    "public": ["echo", "get_info"],        // exact names only, no globs
    "tools": {
      "write_file":     ["MINTER_ROLE"],   // AND across listed roles
      "delete_*":       ["ADMIN_ROLE"],    // globs allowed in keys (tool names)
      "dangerous_call": ["0x9f2d0fe1a2…(full 32-byte role hash)"]  // hashes legal as role values
    }
  },
  "cache": { "allowSeconds": 0, "denySeconds": 10 },   // §6
  "listMode": "annotate",                  // "annotate" | "plain"
  "audit": "./gate-audit.jsonl",
  "server": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem@2025.7.1", "/data"],
    "env": { "API_KEY": "${UPSTREAM_KEY}" },   // ${ENV} references only
    "inherit": ["PATH", "HOME"]                // inheritEnv: false is implied
  }
}
```

### 4.1 Resolution semantics

- Unlisted tools are **denied** — `defaultPolicy` is fixed to `deny` in
  v1 (an `allow` option would silently expose new tools added by a
  wrapped-server update).
- `public` is exact-match only. Glob patterns are allowed in `tools`;
  the most specific match wins (exact > longest pattern); two patterns
  of equal specificity matching the same tool are a **startup config
  error**, not a runtime tiebreak.
- A tool's role list is **AND** (mirrors stacked `onlyHasToken`
  modifiers); within each role, the target's bindings provide **OR**
  (mirrors multiple control tokens per role). Role values may be names
  (hashed with keccak256) or 32-byte role hashes. **Role lists MUST be
  non-empty** (schema `.min(1)`): an empty AND would read as
  unconditional allow. A tool meant to be ungated belongs in `public`,
  stated explicitly.
- Only `tools/call` is gated. **Resources and prompts pass through
  ungated** in v1 — the boundary is the tools/call surface, and the spec
  says so rather than implying whole-server coverage.

### 4.2 Config validation (field-aware secret rejection)

A blanket "reject all 32-byte hex" rule would reject legitimate role
hashes, and post-substitution scanning would reject legitimately
injected upstream keys. Validation is therefore per-field:

- role positions (`gate.tools` keys/values): 32-byte hex **allowed**;
- `server.env` values: MUST exactly match `${[A-Za-z_][A-Za-z0-9_]*}` —
  anything else is rejected. No entropy heuristics; the rule is a
  regex, so it is testable;
- everywhere else: 32-byte hex values are rejected (the tctc-mcp rule,
  applied *before* env substitution).

## 5. Protocol behavior

The gate forwards JSON-RPC traffic with **unchanged request ids**, so
`notifications/cancelled` and `notifications/progress` map through
without translation. Interception points: `initialize`, `tools/list`,
`tools/call`. Everything else — resources, prompts, sampling, logging,
progress — is forwarded verbatim in both directions.

### 5.1 `initialize`

Forwarded. The gate merges capabilities honestly: `capabilities.tools`
is advertised as present (the gate adds tools of its own) with
`listChanged: true` if either the gate or the upstream can emit it; an
upstream `tools/list_changed` notification is forwarded unchanged.
`serverInfo.name` gains a ` (tctc-gated)` suffix and `instructions`
gains one appended paragraph naming the gated tools and their required
roles.

### 5.2 `tools/list` (pagination-correct)

MCP paginates `tools/list`. The gate forwards each page and its cursor
untouched, and appends its own tools **only to the first page** (the
response to the initial cursor-less request), so gate tools appear
exactly once — and remain visible to clients that never follow
`nextCursor`.

- Gate tools live in a reserved prefix: **`tctc_gate_status`** (v1's
  only one; `tctc_gate_challenge`/`tctc_gate_authenticate` arrive with
  prove mode). If an upstream tool uses the `tctc_gate_` prefix it is
  omitted from listings, its calls are denied with
  `TCTC_NAME_COLLISION`, and the collision is logged — shadowing, never
  silent merging.
- `annotate` (default): appends a **static** line to gated tools'
  descriptions — `[tctc-gate: requires MINTER_ROLE on 0x873f…]`. It
  deliberately does *not* embed current HELD/MISSING state: descriptions
  would become dynamic, churning client-side tool caches. Live state
  belongs to `tctc_gate_status`.
- `plain`: no description edits.
- `hide` (list only allowed tools + emit `list_changed` on verdict
  flips) is **v1.1**, shipped together since hiding without change
  notifications strands clients.

### 5.3 `tools/call`

```
resolve policy → public? forward
             → unmapped? deny TCTC_TOOL_UNMAPPED (upstream never called)
             → check roles (pinned block, cache per §6)
             → all held? forward verbatim; return upstream result untouched
             → any missing → deny TCTC_ROLE_DENIED (upstream never called)
```

If `notifications/cancelled` arrives for a request still in its role
check, the gate aborts the check and never forwards. Cancellation of an
already-forwarded request passes through (ids are unchanged).

**Deny wire shape.** A deny is a normal MCP tool result (`isError:
true`), never a protocol error, and never `structuredContent` — a
wrapped tool may declare an `outputSchema`, and structured results must
conform to it. Machine-readable detail rides in namespaced `_meta`:

```jsonc
{
  "isError": true,
  "content": [{ "type": "text",
    "text": "TCTC_ROLE_DENIED: write_file requires MINTER_ROLE on 0x873f…Fd02. Ask your principal to grant it: https://tctc-mcp.vercel.app/?chain=sepolia&target=0x873f…&subject=0x31F8…&roles=MINTER_ROLE" }],
  "_meta": {
    "io.github.kofujimura/tctc-gate": {
      "code": "TCTC_ROLE_DENIED",       // see code taxonomy below
      "tool": "write_file",
      "subject": "0x31F8…5d03",
      "identity": "configured",
      "missing": [{
        "role": "MINTER_ROLE",
        "target": "0x873f…Fd02",
        "evidence": [{ "standard": "erc1155", "contract": "0x1234…eE0B",
                       "typeId": "1", "balanceOf": "0" }]
      }],
      "observedAt": "2026-07-18T09:00:00Z",
      "observedBlockNumber": "11295400",
      "grantUrl": "https://tctc-mcp.vercel.app/?chain=sepolia&target=0x873f…&subject=0x31F8…&roles=MINTER_ROLE"
    }
  }
}
```

**Code taxonomy** — four codes, four distinct situations:

- `TCTC_TOOL_UNMAPPED` — the tool has no policy entry (`defaultPolicy`
  is deny). Carries **no** `grantUrl`: no role would help; the fix is a
  config change by the principal.
- `TCTC_ROLE_DENIED` — mapped, but required roles are missing. Carries
  `grantUrl`.
- `TCTC_CHECK_FAILED` — the verdict is indeterminate (RPC failure,
  pinned-read failure after retry). Fail closed; no `grantUrl`.
- `TCTC_NAME_COLLISION` — reserved-prefix shadowing (§5.2).

`grantUrl` carries `target`, `subject` **and `roles`** (IERC7303 cannot
enumerate roles, but the gate knows exactly which one was missing; the
dashboard already reads the `roles` query parameter). The corresponding
agent-side rule ships in tctc-skills: *on `TCTC_ROLE_DENIED`, surface
the hint to the principal; do not retry, do not attempt to acquire roles
yourself.*

### 5.4 Long-running work and MCP Tasks

Admission control happens at call time. **Revocation prevents future
admissions; it does not cancel an already-forwarded call, stop a running
MCP Task, or undo effects.** Task-creating tools are forwardable in v1
under exactly this documented semantic; per-poll re-checking of task
status calls is future work.

### 5.5 `tctc_gate_status`

Read-only self-check mirroring tctc-mcp's `check_all_roles`: subject,
identity mode, every configured role with held/missing verdict,
per-binding balance evidence, `observedAt` / `observedBlockNumber`, and
cache ages. Lets an agent or a human see the whole gate state without
trial calls.

## 6. Caching, latency, audit

tctc-mcp's caching (10 s on `balanceOf`, 60 s on bindings, `hasRole`
always live) is safe **because the chain re-checks everything behind
it**. For Class B/C resources the gate's allow *is* the final
authorization — a cached allow is a real permission extension. Hence:

- **allow verdicts: `cache.allowSeconds`, default `0`** (every admission
  is a live read). Principals may opt in **globally** — there is no
  per-tool override in v1 — with the tradeoff stated: kill-switch
  latency ≤ allow-cache + block time. A still-valid allow-cache entry is
  honored even if the RPC has since become unreachable (that is what
  caching means); fail-closed governs fresh admissions.
- **deny verdicts: `cache.denySeconds`, default `10`** (a denied agent
  retrying in a tight loop should not hammer the RPC; a *grant* taking
  up to 10 s to be noticed is the benign direction).
- Binding discovery cached 60 s (as tctc-mcp).
- **Pinned reads.** Each live admission check (1) fetches the current
  block number, (2) performs `hasRole` and the balance-evidence reads as
  `eth_call`s **pinned to that block**, and (3) reports that same number
  as `observedBlockNumber` — the reported number can never drift from
  the state it labels. If the endpoint rejects the pinned call, the gate
  retries once with a fresh block number, then fails closed
  (`TCTC_CHECK_FAILED`).
- Every verdict carries `observedAt`, `observedBlockNumber`, and — when
  a cache was involved — `cacheExpiresAt`, so downstream consumers never
  mistake a cached view for a live one.
- Expiring control tokens need no special handling: time-aware
  `balanceOf` makes expiry a verdict flip at the next live read.
- Audit log (optional): JSONL, one line per decision `{ts, chainId,
  target, tool, subject, roles[], verdict, code?, missing?,
  observedBlockNumber, cacheHit, cacheExpiresAt?, forwardedMs?}` — a
  best-effort local record useful for reconciliation against upstream
  logs (§2.1). It is an aid, not a tamper-proof trail, and the spec
  doesn't oversell it.

## 7. What tctc-gate v1 is not

- **Not instance-level validation** — the `validate_action` seam
  (binding first, judgment second) composes above it; a `validator`
  forwarding hook is a v2 seam, deliberately absent.
- **Not proof of caller identity** — `prove` mode is v1.1 (§3.2).
- **Not a remote multi-tenant service** — HTTP/OAuth is v2.
- **Not a sandbox** — it constrains the tools/call boundary of one MCP
  session, nothing else (resources/prompts pass through; OS isolation
  is the principal's job per §2.1).

## 8. Packaging & reuse

- Lives in the tctc-mcp repo as `gate/` (own `package.json`, npm name
  **`tctc-gate`**), like `dashboard/`.
- **The authorization core is not duplicated.** Before M2, the
  discovery/role-check/cache logic is extracted from `src/` into an
  internal workspace package (`@tctc/core`, not published) consumed by
  both tctc-mcp and tctc-gate, with a **shared test-vector suite** that
  both consumers run — divergence in authorization behavior between the
  two products is a test failure, not a code-review hope. (The cache
  -semantics difference §6 documents is exactly the kind of drift
  duplication invites.)
- CLI: `npx tctc-gate --config gate.json` (server command in config), or
  `… -- <command>` override after `--`.

## 9. Test & demo plan

- **Unit**: policy resolution (glob specificity, equal-specificity
  startup error, AND/OR, public exact-match, empty role list rejected at
  schema level), deny shape (`_meta` namespace, text content,
  `TCTC_TOOL_UNMAPPED` vs `TCTC_ROLE_DENIED` discrimination, no
  grantUrl on unmapped), cache behavior (allow=0 live reads, deny TTL),
  pinned-read ordering (block number fetched first, calls pinned to it,
  same number reported), per-field config validation (role hashes pass
  in role positions, literal secrets fail elsewhere, `server.env`
  regex `${[A-Za-z_][A-Za-z0-9_]*}` enforced), chainId pinning, env
  allowlisting.
- **MCP conformance**: paginated `tools/list` with gate tools appearing
  exactly once on the final page; `tctc_gate_` collision shadowing;
  cancellation during role check → no forward; id passthrough for
  progress/cancellation; upstream `list_changed` forwarding.
- **E2E (scripts/e2e-gate.mjs)**: gate wrapping a version-pinned
  third-party server (`@modelcontextprotocol/server-everything`) against
  the Sepolia demo target:
  1. `tctc_gate_status` → missing; gated call → `TCTC_ROLE_DENIED` with
     roles-bearing grantUrl;
  2. grant on-chain → call succeeds; result semantically identical to an
     ungated control run;
  3. `burnByIssuer` → **next admission denies** (allow cache 0 — the
     kill switch through an unmodified third-party server);
  4. timed grant → auto-expiry flips the verdict with no revoke tx;
  5. ungated control comparison: full session **semantic trace**
     (methods, ids, results modulo `serverInfo.name` suffix and
     appended instructions/descriptions) identical — the M1 bar; byte
     equality is not claimed since `initialize` is legitimately edited.
- **Demo video sequel**: the e2e flow with the dashboard on screen as
  the principal's grant/revoke surface.

## 10. v1 scope (deliberately narrow) and milestones

v1 ships: `configured` subject · single target · `defaultPolicy` fixed
to deny · exact-match `public` · allow cache 0 · static `annotate` ·
pagination/cancellation/progress-correct proxying · Tasks forwardable
with documented semantics · `@tctc/core` shared authorization · pinned
upstream + env allowlist. Everything else (prove/SIWE, ERC-1271, hide +
list_changed, HTTP, validator hook, TBA subjects, per-poll task
re-checks) is v1.1+.

| # | Deliverable | Gate |
|---|---|---|
| M1 | Transparent stdio proxy, zero gating — **semantic-trace-identical** against 2–3 real pinned servers, incl. pagination & cancellation | conformance suite green |
| M2 | `@tctc/core` extraction (shared vectors green in tctc-mcp **and** gate) + policy engine + `configured` gating + deny shape + `tctc_gate_status` + annotate | unit + e2e 1–4 |
| M3 | Hardening: audit log, chainId pinning, env hygiene, collision shadowing, docs | full suite green |
| M4 | npm publish `tctc-gate@0.1.0` + README + demo video | published |

The demo's center — *mint a token and an existing MCP tool starts
working; burn it and the next call is refused* — survives every scope
cut above intact. The narrowness is the point: fewer knobs, fewer
claims, each one demonstrable.
