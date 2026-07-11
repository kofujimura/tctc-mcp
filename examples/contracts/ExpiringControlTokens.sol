// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * ExpiringControlTokens — ERC-7303 control tokens with gasless auto-expiry
 *
 * balanceOf() returns 0 once the holder's expiry has passed, so any
 * unmodified ERC-7303 target revokes the role automatically — no
 * transaction, no gas, no cooperation from anyone. Expiry is a fail-safe
 * for forgotten revocations; burnByIssuer remains the immediate kill switch.
 *
 * - One token per account per typeId; re-mint updates the expiry
 *   (grant and extend are the same idempotent operation)
 * - Soulbound: transfers are blocked; only mint (grant) and burn (revoke)
 * - Owner can burn any holder's token (burnByIssuer) at any time
 * - sweep() lets anyone burn an expired token so event-based indexers
 *   converge with balanceOf(); security does not depend on it
 */
contract ExpiringControlTokens is ERC1155, Ownable {
    string public name;

    // typeId => account => expiry (unix seconds); 0 = never granted / revoked
    mapping(uint256 => mapping(address => uint64)) private _expiresAt;

    mapping(uint256 => string) private _tokenURIs;

    event ExpiryUpdated(address indexed account, uint256 indexed id, uint64 expiresAt);

    error Soulbound();
    error ExpiryNotInFuture(uint64 expiry);
    error NotExpired(address account, uint256 id);

    constructor(string memory name_) ERC1155("") Ownable(msg.sender) {
        name = name_;
    }

    function setTokenURI(uint256 id, string calldata tokenURI_) external onlyOwner {
        _tokenURIs[id] = tokenURI_;
    }

    function uri(uint256 id) public view override returns (string memory) {
        return _tokenURIs[id];
    }

    /**
     * Grant `id` to `to` until `expiry`, or move an existing grant's expiry
     * (extension and shortening are both allowed). Never increases balance
     * beyond 1.
     */
    function mint(address to, uint256 id, uint64 expiry) external onlyOwner {
        if (expiry <= block.timestamp) revert ExpiryNotInFuture(expiry);
        if (_rawBalanceOf(to, id) == 0) _mint(to, id, 1, "");
        _expiresAt[id][to] = expiry;
        emit ExpiryUpdated(to, id, expiry);
    }

    /// Immediate revocation regardless of expiry — the kill switch.
    function burnByIssuer(address account, uint256 id) external onlyOwner {
        delete _expiresAt[id][account];
        _burn(account, id, 1);
        emit ExpiryUpdated(account, id, 0);
    }

    /**
     * Burn an expired token. Callable by anyone: expiry already revoked the
     * role via balanceOf(); this only reconciles event-based indexers and
     * clears storage.
     */
    function sweep(address account, uint256 id) external {
        if (_rawBalanceOf(account, id) == 0 || block.timestamp < _expiresAt[id][account]) {
            revert NotExpired(account, id);
        }
        delete _expiresAt[id][account];
        _burn(account, id, 1);
        emit ExpiryUpdated(account, id, 0);
    }

    /// Unix time at which `account`'s grant of `id` expires (0 if none).
    function expiresAt(address account, uint256 id) external view returns (uint64) {
        return _expiresAt[id][account];
    }

    /**
     * Time-aware balance: 0 once expired. This is the entire integration
     * surface — ERC-7303 targets check balanceOf() and need no changes.
     * (OpenZeppelin's balanceOfBatch delegates here.)
     */
    function balanceOf(address account, uint256 id) public view override returns (uint256) {
        return block.timestamp < _expiresAt[id][account] ? super.balanceOf(account, id) : 0;
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    /// Stored balance, ignoring expiry (mint/sweep bookkeeping).
    function _rawBalanceOf(address account, uint256 id) internal view returns (uint256) {
        return super.balanceOf(account, id);
    }
}
