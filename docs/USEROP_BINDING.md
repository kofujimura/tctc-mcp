# `erc4337-userop.v1` — Additive Binding Mode for Smart-Account Flows (draft)

**Status: draft v0, 2026-08-12.** Additive to
[`validate_action` contract v1](./VALIDATE_ACTION.md) (frozen — nothing in it
changes) and to the commit-then-act precedence pattern demonstrated in
[issue #3](https://github.com/kofujimura/tctc-mcp/issues/3). Originates from
the [ERC-7303 thread](https://ethereum-magicians.org/t/erc-7303-token-controlled-token-circulation/15020)
posts 33–35: does commit-then-act extend when the action is wrapped in
account abstraction? Answer: yes — the pattern is two proofs, and only one
of them moves.

## Why

The commit-then-act pattern proves two separate things:

1. **Order** — the commitment landed in a block strictly before the action.
   Block ordering is content-oblivious: it holds regardless of what the
   committed hash refers to or how the action was packaged. This half
   carries over to ERC-4337 / ERC-6551 **unchanged**, and so does the
   commit contract — `VerdictCommits` stores 32 opaque bytes per
   `msg.sender`; the binding discipline lives entirely off-chain, in the
   recipe for what the hash's preimage points to.

2. **Identity** — *which* action, and *whose*. This is the half that moves.
   In the EOA demo, the mined transaction carried both: its calldata was
   the action (`artifact_type = "evm-tx-tuple.v1"` binds
   `{chainId, target, value, calldata}`), and its sender was the issuer.
   Under ERC-4337 the mined transaction is the bundler's `handleOps` batch:
   `tx.from` is the bundler and the outer calldata is the bundler's, not
   the agent's. Binding to the raw transaction tuple points at the
   envelope, not the act.

The chain still attests the act, though: the EntryPoint emits
`UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, …)`
in the mined block. So the binding moves to the **userOpHash**, and "who
acted" moves to the **smart account** (`UserOperationEvent.sender`).

## Artifact

- `artifact_type = "erc4337-userop.v1"`
- `artifact_hash = sha256(JCS({chainId, entryPoint, userOpHash}))`
- **Preimage normalization** (same discipline as the v1 tuple
  normalization): `chainId` is a JSON number; `entryPoint` and `userOpHash`
  are lowercased `0x`-prefixed hex strings; JCS = RFC 8785.

Two deliberate choices:

- **`entryPoint` is named in the preimage even though the userOpHash
  construction already commits to it.** The redundancy is the point:
  userOpHash computation is EntryPoint-version-specific (the v0.6
  `UserOperation` struct and the v0.7 `PackedUserOperation` pack
  differently), so an independent verifier must know *which* construction
  to recompute before it can check anything. Naming the EntryPoint makes
  the recipe self-contained instead of guessable — the same lesson as the
  `decision_ref` preimage pinning and the hex-case normalization in v1:
  every recompute an independent implementation must perform gets its
  recipe written down.
- **The verdict binds to the *final signed* UserOp.** userOpHash covers the
  gas and paymaster fields, so any post-validation re-estimation (a common
  bundler-side step) produces a different hash and silently unbinds the
  verdict. The agent-side rule is the existing one — rebuild-and-revalidate
  if anything changes — applied strictly: validate after the UserOp is
  final, sign, send exactly that. (`signature` itself is *not* part of
  userOpHash — it is what gets signed — so signing after validation is
  fine.)

Binding-first still applies exactly as in v1 Semantics 1/3: the validator
recomputes the inner calldata from `intent`, checks the wrapper decode
(`execute(dest, value, func)` → inner tuple matches `intent`, Semantics 3),
computes the userOpHash of the final UserOp per the pinned EntryPoint
version, and that hash — not the raw calldata — is what the attestation's
artifact commits to. `executeBatch` remains out of scope, mirroring the v1
batch rejection: one artifact, one inner call, until a v2 design round.

## What this mode improves over `evm-tx-tuple.v1`

In the issue #3 EOA demo, one soft link remained at close: the verdict's
artifact was a plan-shaped preimage, so "the verdict was *about this
specific action*" rested on data the issuer chose to publish. Under this
mode the identifier is **logged by consensus**: the auditor reads
`UserOperationEvent` from the mined block, recomputes
`sha256(JCS({chainId, entryPoint, userOpHash}))` from the log's own fields,
and compares it to the verdict's `artifact_hash` — the verdict-to-action
binding closes from chain data plus the published signed event alone, with
nothing extra published. That is precisely the closure route noted when
issue #3 was wrapped up ("have the verdict bind to what the chain attests,
at which point the artifact recomputes from the mined transaction").

## Audit recipe

The three checks from issue #3, adapted. Everything below is recomputable
from public endpoints plus the published signed verdict event.

1. **Order.** `Committed(issuer, H)` on `VerdictCommits` at block N;
   `UserOperationEvent(userOpHash, sender, …)` on the EntryPoint at block
   M; require **N < M**. Receipts and logs only — no timestamps trusted.
2. **Verdict.** Unchanged from issue #3: recompute
   `H = sha256(JCS(full signed event, sig included))` and match the
   committed value; recompute the NIP-01 id; verify the BIP-340 signature;
   recompute `decision_ref`. **New:** recompute `artifact_hash` from
   `{chainId, entryPoint, userOpHash}` using the userOpHash read out of the
   mined `UserOperationEvent`, and require equality with the verdict's
   `artifact_hash`. This is the check that was structurally unavailable in
   the EOA demo.
3. **Issuer scoping.** In the EOA demo this was "same `tx.from` on commit
   and action" — unavailable here, since `tx.from` is the bundler on both.
   The scoping migrates to the smart account: the commit MUST be routed
   through the same account (the account calls
   `VerdictCommits.commit(H)` via its own `execute`, so the commit
   contract records `msg.sender = the account`; the commit may itself be a
   UserOp). The check becomes
   **`Committed.issuer == UserOperationEvent.sender`**. No change to
   `VerdictCommits` — it already records `msg.sender`; only who that
   sender is changes.

### ERC-6551 addendum

A token-bound account is a smart account, so the recipe above applies
verbatim. What ERC-6551 adds is a fourth, optional check that *strengthens*
the accountability chain: recompute the TBA address from the canonical
registry derivation (v1 Semantics 3's known-wrapper check), then archive
`eth_call` `ownerOf(tokenId)` on the token contract **at block M**. That
names the NFT holder at the moment of the action as a second,
independently-checkable identity fact — the account contract is not trusted
to report its own owner.

## Worked example (synthetic, EntryPoint v0.7)

Synthetic per EM #35 ("a synthetic one with the exact fields named is
enough to start from") — no mined UserOp yet; every value below recomputes
from the fields as given. The inner action deliberately mirrors the issue
#3 demo: the same `mint(to, MINTER_CERT, 1)` on the same redeployed
`AgentControlTokens`, now wrapped in a smart account's `execute`.

| Field | Value |
|---|---|
| `chainId` | `11155111` (Sepolia) |
| `entryPoint` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (canonical v0.7) |
| `sender` | `0x7303730373037303730373037303730373037303` (synthetic account) |
| `nonce` | `7` |
| inner call | `mint(0x7303…7303, 1, 1)` on `0x127093739bb7aF8Aa05e89806Fa8C98941335119` |
| `callData` | `execute(0x127093…5119, 0, innerCalldata)` — hex below |
| `callGasLimit` | `100000` |
| `verificationGasLimit` | `150000` |
| `preVerificationGas` | `50000` |
| `maxFeePerGas` | `2000000000` (2 gwei) |
| `maxPriorityFeePerGas` | `1000000000` (1 gwei) |
| `factory` / `factoryData` | none (no initCode) |
| paymaster fields | none |
| `signature` | `0x` (dummy — not part of userOpHash) |

```
innerCalldata = 0x156e29f6
  0000000000000000000000007303730373037303730373037303730373037303
  0000000000000000000000000000000000000000000000000000000000000001
  0000000000000000000000000000000000000000000000000000000000000001

callData = 0xb61d27f6
  000000000000000000000000127093739bb7af8aa05e89806fa8c98941335119
  0000000000000000000000000000000000000000000000000000000000000000
  0000000000000000000000000000000000000000000000000000000000000060
  0000000000000000000000000000000000000000000000000000000000000064
  156e29f6…(innerCalldata, right-padded)
```

**v0.7 hash construction** (for verifiers not using an existing 4337
library):

```
packed  = abi.encode(sender, nonce,
                     keccak256(initCode),          // keccak256(0x) here
                     keccak256(callData),
                     accountGasLimits,             // bytes32: verificationGasLimit(16) ‖ callGasLimit(16)
                     preVerificationGas,
                     gasFees,                      // bytes32: maxPriorityFeePerGas(16) ‖ maxFeePerGas(16)
                     keccak256(paymasterAndData))  // keccak256(0x) here
userOpHash = keccak256(abi.encode(keccak256(packed), entryPoint, chainId))
```

**Computed values** — reproducible with
[`scripts/userop-binding-example.mjs`](../scripts/userop-binding-example.mjs)
(viem 2.54.5 `getUserOperationHash`, entryPointVersion `"0.7"`); the manual
construction above was cross-checked against it and produces the identical
hash:

```
userOpHash    = 0xcb26b0450ee1dae386bca923a6cde20edc4315e8b109ad442272ec253b70cba8

preimage(JCS) = {"chainId":11155111,"entryPoint":"0x0000000071727de22e5e9d8baf0edac6f37da032","userOpHash":"0xcb26b0450ee1dae386bca923a6cde20edc4315e8b109ad442272ec253b70cba8"}

artifact_hash = sha256:fadbde7d9b3101a6172a7cf2a8d33d677b4cef6024f5eb0b52020c9641ce0451
```

Had this UserOp been mined, the auditor's checks would read: (1)
`Committed(0x7303…7303, H)` at some block N on `VerdictCommits`, and
`UserOperationEvent(0xcb26b045…, 0x7303…7303, …)` on the v0.7 EntryPoint at
block M > N; (2) the published signed verdict event hashes to H and carries
`artifact_hash = sha256:fadbde7d…`, which recomputes from the event log's
userOpHash via the preimage above; (3) `Committed.issuer` equals
`UserOperationEvent.sender`.

## Non-goals / open

- **`executeBatch` / multicalls:** out of scope, same stance as contract
  v1 — one artifact, one inner call. A batch UserOp has a single
  userOpHash, so the *order* proof would hold, but the inner-tuple
  recompute (Semantics 3) has no single tuple to bind; deferred to a v2
  round.
- **Other EntryPoint versions:** the mode is version-agnostic by
  construction — pin the EntryPoint address in the preimage, recompute with
  that version's hash construction (v0.6:
  `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, legacy struct packing;
  later versions likewise). The example pins v0.7 as the current common
  deployment.
- **Real testnet UserOp:** the natural second step (EM #35). The synthetic
  example fixes the recipe; a mined Sepolia UserOp performing the
  commit-then-mint pair through a real smart account would let every value
  above be recomputed from receipts instead of given fields.

## References

- Contract v1 (frozen): [VALIDATE_ACTION.md](./VALIDATE_ACTION.md)
- Commit-then-act worked example (EOA): https://github.com/kofujimura/tctc-mcp/issues/3
- ERC-7303 thread posts 33–35: https://ethereum-magicians.org/t/erc-7303-token-controlled-token-circulation/15020/33
- ERC-4337 (EntryPoint, `UserOperationEvent`, userOpHash): https://eips.ethereum.org/EIPS/eip-4337
- ERC-6551 (registry derivation): https://eips.ethereum.org/EIPS/eip-6551
