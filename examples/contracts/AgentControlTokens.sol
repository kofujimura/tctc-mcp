// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * AgentControlTokens — ERC-7303 control tokens for AI agent delegation
 *
 * - Soulbound: transfers are blocked; only mint (grant) and burn (revoke)
 * - Owner-only mint
 * - Owner can burn any holder's token (burnByIssuer) — the on-chain kill switch
 * - typeId 1 = MinterCert, typeId 2 = BurnerCert; other ids are free for new roles
 */
contract AgentControlTokens is ERC1155, Ownable {
    string public name;

    uint256 public constant MINTER_CERT = 1;
    uint256 public constant BURNER_CERT = 2;

    mapping(uint256 => string) private _tokenURIs;

    error Soulbound();

    constructor(string memory name_) ERC1155("") Ownable(msg.sender) {
        name = name_;
    }

    function setTokenURI(uint256 id, string calldata tokenURI_) external onlyOwner {
        _tokenURIs[id] = tokenURI_;
    }

    function uri(uint256 id) public view override returns (string memory) {
        return _tokenURIs[id];
    }

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        _mint(to, id, amount, "");
    }

    function burnByIssuer(address account, uint256 id, uint256 amount) external onlyOwner {
        _burn(account, id, amount);
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
}
