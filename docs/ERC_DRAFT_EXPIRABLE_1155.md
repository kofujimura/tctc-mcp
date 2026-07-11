> **Status: working draft — not yet submitted.**
> This is the working draft of an ERC the author intends to propose to
> [ethereum/ERCs](https://github.com/ethereum/ERCs). No ERC number has been
> assigned (`eip`/`IERCxxxx` are placeholders filled at submission time), and
> the discussion thread on Ethereum Magicians has not been opened yet. The
> normative content may still change before submission. A working
> implementation is live on Sepolia — see the
> [timed-roles section of the README](../README.md#timed-roles-gasless-auto-expiry-v03)
> and `examples/contracts/ExpiringControlTokens.sol` — and feedback via
> issues on this repository is welcome.

---
eip: TBD
title: Expirable ERC-1155 Tokens
description: Per-holder expiry for ERC-1155 balances; expired balances read as zero, revoking token-gated permissions without a transaction
author: Ko Fujimura (@kofujimura)
discussions-to: TBD
status: Draft
type: Standards Track
category: ERC
created: 2026-07-12
requires: 165, 1155
---

## Abstract

This ERC extends [ERC-1155](./eip-1155.md) with an expiry recorded per holder and token type. Once the expiry passes, `balanceOf` reports zero, so any system that grants permissions by token balance — such as [ERC-7303](./eip-7303.md) role gating — revokes the permission automatically, without any transaction being sent. The extension adds one view function, `expiresAt(account, id)`, and one event, `ExpiryUpdated`, detectable via [ERC-165](./eip-165.md) with interface ID `0x300e616b`.

## Motivation

Token-gated authorization represents a permission as token ownership: granting is minting, revoking is burning, and the check is `balanceOf > 0`. When the holder is an autonomous agent, delegation is typically short-lived — "mint for one hour", "act for the duration of this task". A fail-safe delegation must end even if the principal forgets to revoke, is offline, or has lost keys. That requires revocation that costs no transaction.

On-chain state does not change by itself, so the only way to expire a permission without a transaction is to evaluate time at check time. Placing that evaluation inside the credential token's `balanceOf` confines the entire mechanism to the token contract: consumer contracts that check balances — including already-deployed ones — need no changes.

The recorded expiry must also be readable and indexable, so that wallets, dashboards, and agent tooling can display remaining validity, warn before expiry, and renew in time. This ERC standardizes that surface. [ERC-5643](./eip-5643.md) standardizes subscription expiry for ERC-721, but as metadata attached to a token ID: `balanceOf` is unaffected, so balance-gated permissions do not end at expiry. No expiry standard exists for ERC-1155.

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119 and RFC 8174.

Every compliant contract MUST implement [ERC-1155](./eip-1155.md), [ERC-165](./eip-165.md), and the following interface:

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.0;

/// Detectable via ERC-165 with interface ID 0x300e616b.
interface IERCxxxx /* is IERC1155, IERC165 */ {
    /// @notice Emitted whenever the expiry recorded for (account, id) is
    ///         set, changed, or cleared. A cleared expiry is emitted as 0.
    event ExpiryUpdated(address indexed account, uint256 indexed id, uint64 expiresAt);

    /// @notice The time (unix seconds) at which `account`'s holding of
    ///         token type `id` expires. 0 means no expiry is recorded.
    function expiresAt(address account, uint256 id) external view returns (uint64);
}
```

1. `supportsInterface(0x300e616b)` MUST return `true`.
2. `expiresAt(account, id)` MUST return the expiry recorded for the pair, or 0 if none is recorded.
3. If a non-zero expiry is recorded and `block.timestamp >= expiresAt(account, id)`, then `balanceOf(account, id)` MUST return 0. `balanceOfBatch` MUST be consistent with `balanceOf`.
4. The contract MUST emit `ExpiryUpdated` in the same transaction as any change to a recorded expiry: setting it at grant, moving it (extension or shortening), and clearing it (emitted with `expiresAt = 0`) when the underlying balance is burned.
5. Granting token type `id` to an account that already holds it SHOULD update the recorded expiry instead of increasing the balance, so that grant and extension are the same idempotent operation.
6. Balances with a recorded expiry MUST NOT be transferable: `safeTransferFrom` and `safeBatchTransferFrom` MUST revert for them. Minting and burning are not transfers.
7. The contract MAY expose a permissionless function that burns a balance whose expiry has passed, emitting the standard `TransferSingle` and `ExpiryUpdated(account, id, 0)`. Authorization MUST NOT depend on this cleanup being performed (see Security Considerations).

## Rationale

**Expiry lives in the credential token, not the consumer.** Any alternative placement — a new modifier, a registry, a session manager — requires changes to the contracts that check permissions. Evaluating expiry inside `balanceOf` means every existing balance-gated consumer, including deployed [ERC-7303](./eip-7303.md) targets, gains expiring permissions by simply being pointed at a compliant credential token.

**Per-(account, id), not per token unit.** ERC-1155 permission checks are account-scoped (`balanceOf(account, id) > 0`), so one expiry per holder and token type is the natural granularity. It also makes re-granting idempotent (item 5): "grant" and "extend" become the same call, and a holder never accumulates duplicate credentials. Tracking expiry per individual unit would require per-unit accounting, which is the ERC-721 model already served by [ERC-5643](./eip-5643.md).

**Expiring balances are non-transferable.** The expiry is bound to the holder, so its meaning does not survive a transfer, and a single recorded expiry cannot describe an account holding units received at different times. Expiring credentials — licenses, memberships, delegated permissions — are held, not traded. Transferable assets with time limits should record expiry per token instead.

**`uint64`.** Sufficient for any realistic timestamp, and packs with an address in storage.

**Expiry is silent by design.** Nothing executes at the moment of expiry, so no event marks it; the tradeoff is described in Backwards Compatibility, and item 7 names the reconciliation pattern. This is the price of transaction-free revocation.

**Relation to off-chain permits.** Signed, time-limited session keys also expire without transactions, but the permission then exists only in a signature held by the delegate: there is no token that third parties can audit with `balanceOf`, and no on-chain issuer-side burn. This ERC keeps the permission a public, enumerable, revocable on-chain object.

## Backwards Compatibility

Compliant contracts are fully ERC-1155 compliant; consumers need no knowledge of this extension.

One behavior deviates from what event-tracking tooling assumes: an expired balance reads as 0 without any `TransferSingle` having been emitted, so indexers that reconstruct balances from transfer events will over-report until the expired balance is swept (item 7). This deviation is deliberate — it is what makes revocation free — and MUST be resolved by reading `balanceOf`, never by event reconstruction (see Security Considerations).

## Test Cases

With `T` the block timestamp at grant, an issuer grants token type 1 to Alice expiring at `T + 3600`:

- `expiresAt(alice, 1)` returns `T + 3600`; `balanceOf(alice, 1)` returns 1; `ExpiryUpdated(alice, 1, T + 3600)` was emitted.
- Granting again with expiry `T + 7200`: `balanceOf(alice, 1)` still returns 1; `expiresAt(alice, 1)` returns `T + 7200`; `ExpiryUpdated` emitted.
- `safeTransferFrom(alice, bob, 1, 1, "")` reverts.
- At any `block.timestamp >= T + 7200`: `balanceOf(alice, 1)` returns 0 and `balanceOfBatch([alice], [1])` returns `[0]`, with no transaction having occurred; `expiresAt(alice, 1)` still returns `T + 7200`.
- After cleanup (item 7) or an issuer burn: `expiresAt(alice, 1)` returns 0 and `ExpiryUpdated(alice, 1, 0)` was emitted.
- `supportsInterface(0x300e616b)` returns `true`.

## Reference Implementation

```solidity
// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ExpirableERC1155 is ERC1155, Ownable {
    // id => account => expiry (unix seconds); 0 = none recorded
    mapping(uint256 => mapping(address => uint64)) private _expiresAt;

    event ExpiryUpdated(address indexed account, uint256 indexed id, uint64 expiresAt);

    error TransferOfExpiringToken();
    error ExpiryNotInFuture(uint64 expiry);
    error NotExpired(address account, uint256 id);

    constructor() ERC1155("") Ownable(msg.sender) {}

    /// Grant `id` to `to` until `expiry`, or move an existing grant's expiry.
    function mint(address to, uint256 id, uint64 expiry) external onlyOwner {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture(expiry);
        if (_rawBalanceOf(to, id) == 0) _mint(to, id, 1, "");
        _expiresAt[id][to] = expiry;
        emit ExpiryUpdated(to, id, expiry);
    }

    /// Issuer-side revocation, effective immediately regardless of expiry.
    function burnByIssuer(address account, uint256 id) external onlyOwner {
        delete _expiresAt[id][account];
        _burn(account, id, 1);
        emit ExpiryUpdated(account, id, 0);
    }

    /// Burn an expired balance. Callable by anyone: expiry already ended the
    /// permission via balanceOf; this only reconciles event-based indexers.
    function sweep(address account, uint256 id) external {
        if (_rawBalanceOf(account, id) == 0 || block.timestamp < _expiresAt[id][account]) {
            revert NotExpired(account, id);
        }
        delete _expiresAt[id][account];
        _burn(account, id, 1);
        emit ExpiryUpdated(account, id, 0);
    }

    function expiresAt(address account, uint256 id) external view returns (uint64) {
        return _expiresAt[id][account];
    }

    /// Time-aware balance: 0 once expired. This is the entire integration
    /// surface — balance-gated consumers need no changes.
    function balanceOf(address account, uint256 id) public view override returns (uint256) {
        return block.timestamp < _expiresAt[id][account] ? super.balanceOf(account, id) : 0;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0x300e616b || super.supportsInterface(interfaceId);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) revert TransferOfExpiringToken();
        super._update(from, to, ids, values);
    }

    function _rawBalanceOf(address account, uint256 id) internal view returns (uint256) {
        return super.balanceOf(account, id);
    }
}
```

## Security Considerations

**Expiry complements revocation; it does not replace it.** For delegation to autonomous agents, the issuer MUST retain the ability to burn the credential unilaterally within its validity window (the kill switch of [ERC-7303](./eip-7303.md)'s security considerations); expiry is the fail-safe for revocations that never happen.

**Verify with `balanceOf`, never with events.** Balances reconstructed from transfer events do not see expiry (see Backwards Compatibility). Any off-chain verifier MUST call `balanceOf` (or the consumer's own check, e.g. `hasRole`); on-chain consumers are correct by construction.

**Timestamp precision.** `block.timestamp` has second granularity and is minimally manipulable by block producers. This mechanism suits validity windows of minutes to years, not sub-minute precision.

**Expired state persists until swept.** An expired, unswept balance holds storage and remains visible to event-based tooling. The permissionless cleanup of item 7 bounds this to one burn per (account, id) and grants no other authority.

## Copyright

Copyright and related rights waived via [CC0](../LICENSE.md).
