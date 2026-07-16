# `validate_action` — Pre-Action Instance Validation (contract v1)

**Status: v1, frozen 2026-07-09.** Specified in the open in
[issue #1](https://github.com/kofujimura/tctc-mcp/issues/1) together with
@babyblueviper1, originating from the
[ERC-7303 discussion thread](https://ethereum-magicians.org/t/erc-7303-token-controlled-token-circulation/15020)
(posts 13–16).

## Why

ERC-7303 role gating is **class-level** authorization: it determines whether
an agent may perform a class of actions at all. It deliberately does not
judge whether a **specific instance** of the action is sound right now —
position sizing, a stale input, a prompt-injected instruction that is still
within the granted role.

`validate_action` is the seam for that instance-level judgment: a pre-action
check between building a transaction and sending it, with the discipline
**binding first, judgment second** — the validator first proves that the
bytes about to execute are the thing it is judging, then reasons about
soundness. A check that skips the binding step can be bypassed without
anyone noticing: the check ran, it just checked the wrong thing
(authorized-args ≠ executed-args).

**Scope note:** tctc-mcp stays deliberately scoped to *authorization* (roles
as tokens; `check_role` / `grant_role` / `revoke_role`). `validate_action`
is a contract to be implemented by a separate policy/validation server. What
belongs to this project is (a) this specification of the seam, and (b) the
mandated calling order in the agent delegation rules shipped with
[tctc-skills](https://github.com/kofujimura/tctc-skills) (rule 5). MCP makes
the composition trivial: two servers, one mandated ordering.

## Flow

```
check_role  →  build tx  →  validate_action  →  send
(class gate)               (instance gate)
```

- `check_role` (tctc-mcp): may the agent perform this action class at all?
  Advisory; the on-chain `onlyHasToken` modifier is the enforcement point.
- `validate_action` (validator server): is *this one, now, this size* sound?
  Advisory at this layer; account-side execution modules (spend caps, HITL)
  are its on-chain counterpart.

The two gates enforce independently and compose with **zero changes** to
ERC-7303 or to target contracts.

## Request

```jsonc
{
  "intent": {
    "role": "MINTER_ROLE",              // role the agent believes it is acting under
    "chain": "sepolia",                 // chain key; resolves to a chainId
    "target": "0xa52f...09BD",          // contract to be called
    "function": "safeMint(address)",    // canonical signature
    "args": ["0x31F8...5d03"],          // decoded args, one JSON value per ABI input
    "value": "0"                        // wei, decimal string
  },
  "calldata": "0x40d097c3...",          // the exact bytes the agent will send
  "context": {
    "agent": "0x...",                   // sending account (EOA / ERC-6551 TBA / smart account)
    "sessionId": "...",                 // optional opaque correlation id
    "inputCommitment": "0x..."          // optional, e.g. an ERC-8299 (WYRIWE) input_hash
  }
}
```

## Response

```jsonc
{
  "verdict": "allow" | "deny",
  "failureClass": null | "BINDING_MISMATCH" | "POLICY_DENIED",
  "binding": {
    "state": "verified" | "reduced-confidence" | "not-attempted",
    "gap": null | "wrapper implementation unverified",  // machine-checkable, named gap
    "recomputedCalldata": "0x...",      // canonical encoding of intent.function + intent.args
    "wrapper": {                        // present only when the sent calldata wraps the bound inner call
      "type": "erc-4337-simple-account" | "erc-6551-tba" | "...",
      "implementationHash": "0x...",    // bytecode hash matched to a known reference, or registry derivation
      "note": "..."
    }
  },
  "reasons": ["..."],                   // human/agent-readable, required on deny
  "attestation": { }                    // signed verdict envelope — see below
}
```

`binding.state` is deliberately three-way, not a boolean: `verified` (fully
recomputed), `reduced-confidence` (recomputed, but with a named unverified
gap), `not-attempted` (binding could not run — malformed intent, unsupported
wrapper type; always a deny).

**Attestation envelope.** `attestation` carries an
[`invinoveritas.verdict_proof.v1`](https://gist.github.com/babyblueviper1/0cd64d89d633386d5174dfa9f7916a7c)
proof, with the artifact specialized for this seam:

- `artifact_type = "evm-tx-tuple.v1"`
- `artifact_hash = sha256(JCS({chainId, target, value, calldata}))` — the
  **full transaction tuple**, not calldata alone (calldata omits the
  destination; binding it alone would leave target/value/chain unbound)
- `decision_ref = "sha256:" + sha256(JCS({artifact_hash, artifact_type,
  policy_version, verdict, source_class, vantage_limitation}))` per the
  proof's own published `decision_ref_preimage_fields`
- JCS = RFC 8785 canonical JSON, so independent implementations recompute
  identical bytes — the same no-trusted-representations discipline as
  canonical ABI encoding on the calldata side.
- **Tuple normalization (v1 clarification, 2026-07-16):** before JCS, the
  tuple's hex-string fields (`target`, `calldata`) MUST be lowercased
  `0x`-prefixed hex; `value` is a decimal string and `chainId` a JSON
  number. The byte-equality check in Semantics 1 compares bytes, so hex
  case cannot affect the verdict — but the JCS preimage is a *string*, and
  without a pinned case two honest implementations recompute different
  `artifact_hash` values for the same transaction (checksummed vs
  lowercased `target`, uppercase-hex `calldata`). Changes no semantics;
  pins the preimage. Surfaced by the first independent implementation
  ([issue #2](https://github.com/kofujimura/tctc-mcp/issues/2)).

## Semantics

1. **Binding (normative, runs first).** The validator MUST recompute the
   canonical ABI encoding of `intent.function` + `intent.args` and require
   **byte equality** with `calldata`. Because `calldata` alone does not
   carry the destination, the binding covers the full transaction tuple:
   `(chainId, target, value, calldata)` — all four come from `intent`, and
   the agent MUST send exactly that tuple or nothing. On any mismatch:
   `verdict = "deny"`, `failureClass = "BINDING_MISMATCH"`, and **no
   judgment is performed**.

   Canonical ABI encoding is deterministic for standard types, so this step
   is a pure recomputation — no decode heuristics, no equivalent-encodings
   ambiguity. Intent-to-args drift survives only *above* this level, which
   is exactly where the judgment belongs.

2. **Judgment (policy-defined, runs second).** The validator reasons over
   `intent` (and `context`) only — limits, freshness, escalation to a human,
   anything the policy defines. A denial here is
   `failureClass = "POLICY_DENIED"` with `reasons`.

   The two failure classes are deliberately distinct: a binding mismatch
   means the *pipeline* is broken or adversarial; a policy denial means the
   pipeline is honest and the *request* was judged unsound. Agents and
   monitors should treat them differently.

3. **Wrapper binding (ERC-4337 / ERC-6551).** When the sent calldata wraps
   the bound inner call (ERC-4337 userOp, ERC-6551 `TBA.execute()`), the
   binding upgrades to `"verified"` **iff both** hold:

   - *inner-tuple recompute*: the validator decodes the wrapper call, and
     the extracted inner `(target, value, innerCalldata)` matches `intent` —
     `innerCalldata` byte-equals the canonical encoding of `intent.function`
     + `intent.args`, `target` equals `intent.target`, `value` equals
     `intent.value`, and the executing chain resolves to `intent.chain`'s
     chainId. All four fields — leaving any of them unchecked reopens
     exactly the gap the tuple binding closed;
   - *known wrapper semantics*: the wrapper's execution semantics are
     independently known — bytecode hash matched to a known reference
     implementation (e.g. canonical SimpleAccount), or the account address
     recomputed from a canonical registry derivation
     (`ERC6551Registry.account(implementation, chainId, tokenContract,
     tokenId, salt)` resolving to `context.agent`). **The standard doesn't
     buy `verified`; a known implementation of the standard does.**

   If the recompute matches but the wrapper implementation is unrecognized,
   the **record** carries `binding.state = "reduced-confidence"` with the
   specific gap named — rather than rounding to full-trust or full-deny. The
   **agent-side rule stays binary**: reduced-confidence maps to *deny*
   unless the principal's config explicitly opts that role into accepting
   the named gap. Rich record, conservative default — the flag must not
   become the bypass. Worked ERC-4337 request/response:
   [issue #1 comment](https://github.com/kofujimura/tctc-mcp/issues/1#issuecomment-4919670415).

4. **Agent-side rules** (shipped as
   [rule 5 of the tctc-skills delegation rules](https://github.com/kofujimura/tctc-skills/blob/main/SKILL.md)):
   - never send a transaction tuple that was not bound and allowed by
     `validate_action`;
   - rebuild-and-revalidate if anything in the tuple changes after
     validation — a stale verdict binds nothing;
   - reduced-confidence binding = deny unless the role is explicitly opted
     in by the principal;
   - **fail closed**: if the validator is unreachable, do not send.

## Batches / multicalls

**Rejected in v1.** One artifact, one tuple keeps the binding proof simple.
Whether binding applies per-call-in-batch or to the batch as one artifact is
a real question, but it deserves its own design round (contract v2) rather
than riding in on v1.

## Known implementations

- [babyblueviper1/tctc-validate-action](https://github.com/babyblueviper1/tctc-validate-action)
  — first known implementation (Python/FastAPI; judgment backed by
  invinoveritas `/review`). Direct-call binding + attestation envelope;
  wrapper binding (Semantics 3) reported as `not-attempted`, per spec.
  Independently verified against this contract at
  [`941b2ce`](https://github.com/babyblueviper1/tctc-validate-action/commit/941b2ce)
  ([issue #2](https://github.com/kofujimura/tctc-mcp/issues/2)).

## References

- Specification discussion: https://github.com/kofujimura/tctc-mcp/issues/1
- ERC-7303 thread, posts 13–16: https://ethereum-magicians.org/t/erc-7303-token-controlled-token-circulation/15020/13
- Attestation companion doc (decision_ref preimage spec): https://gist.github.com/babyblueviper1/0cd64d89d633386d5174dfa9f7916a7c
- Layering (role gate = class-level; instance soundness composes above it): [CONCEPT.md](./CONCEPT.md)
- ERC-8299 (WYRIWE) — input provenance commitments: https://ethereum-magicians.org/t/erc-8299-wyriwe-what-you-read-is-what-you-execute/28655
